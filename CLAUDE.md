# CLAUDE.md

Guia para o Claude Code trabalhar neste repositório.

## Comandos

```bash
npm run dev          # dev server em http://localhost:3000
npm run build        # produção (roda: prisma generate && prisma db push && next build)
npm run db:push      # aplica o schema no banco sem build
npm run db:studio    # Prisma Studio (editor visual do banco)
```

Sem suite de testes. Validação de tipos via `npm run build` (ou `npx tsc --noEmit`).

## Arquitetura

Next.js 14 App Router — páginas e API routes no mesmo projeto. Sem autenticação.
Prisma + PostgreSQL (Neon). Schema gerenciado com `prisma db push` — **sem arquivos de migration**.

**Variáveis de ambiente** (`.env`, ver `.env.example`):
- `DATABASE_URL` — Neon pooling URL (runtime)
- `DIRECT_URL` — Neon direct URL (usada pelo `prisma db push` no build)

No boot, `src/lib/prisma.ts` semeia **apenas** a conta `9.9.01 — Transferência entre Contas`.

## Restrição de TypeScript

O target é `es5`: **não** iterar `Map`/`Set` com `for...of` nem espalhar com `[...set]`.
Sempre `Array.from()`:

```typescript
// ❌ quebra no build
const arr = [...set]
for (const [k, v] of map) { }

// ✅ correto
const arr = Array.from(set)
Array.from(map.entries()).forEach(([k, v]) => { })
```

## Modelo de dados

| Modelo | Papel |
|---|---|
| `Unit` | unidade de negócio (loja/filial) |
| `BankAccount` | conta bancária/caixa de uma unidade |
| `Account` | plano de contas — `dreGroup` define a posição na DRE |
| `Transaction` | lançamento; `amount` negativo = saída, positivo = entrada |

**Transaction — campos que importam:**
- `fitid` (unique) — chave anti-duplicata gerada no import (`sf_{arquivo}_{data}_{centavos}_{n}`)
- `month` / `year` — **competência contábil**, pode diferir de `date` (import com "tudo no mês X")
- `accountId` null = não classificado → **fora da DRE**
- `transferToUnitId` / `transferToBankAccountId` — destino da transferência; a contrapartida
  de entrada é criada com `fitid = original + '_entrada'`

## Páginas

| Rota | Função |
|---|---|
| `/dashboard` | KPIs, composição de despesas, ponto de equilíbrio, evolução anual. Abre em Consolidado Anual (`month=0`) |
| `/lancamentos` | Import de planilha de contas pagas/recebidas + lançamento manual + tabela do período |
| `/dre` | DRE estruturada com AV%, três pontos de equilíbrio, comparativo e histórico mensal |
| `/plano-de-contas` | CRUD do plano de contas + import Excel/CSV |
| `/unidades` | CRUD de unidades e contas bancárias |

## API

| Rota | Função |
|---|---|
| `GET /api/dre?month&year&unitId` | `{ dre, yearData }` — `month=0` = consolidado do ano |
| `GET/POST /api/transactions` | lista do período / lançamento manual |
| `PUT/DELETE /api/transactions/[id]` | classificar / excluir |
| `POST /api/import/parse` | multipart → matriz da planilha + colunas detectadas |
| `POST /api/import/check` | `{ fitids }` → quais já existem no banco |
| `POST /api/import` | grava o lote (`createMany` + `skipDuplicates`) |
| `POST /api/classify/suggest` | `{ memos }` → sugestões Jaccard do histórico |
| `GET/POST /api/accounts`, `PUT/DELETE /api/accounts/[id]` | plano de contas |
| `POST /api/accounts/import` | Excel/CSV → plano de contas |
| `GET/POST /api/units`, `PUT/DELETE /api/units/[id]` | unidades |
| `POST /api/bank-accounts`, `PUT/DELETE /api/bank-accounts/[id]` | contas bancárias |

## Fluxo de import (`/lancamentos`)

1. `POST /api/import/parse` — lê xlsx/csv, acha a linha de cabeçalho (varre as 15 primeiras)
   e mapeia data/descrição/valor/crédito/natureza por sinônimos (`src/lib/spreadsheet.ts`)
2. O **cliente** converte a matriz em lançamentos com `mapRows()` (`src/lib/import-mapper.ts`) —
   trocar o mapeamento de colunas recalcula a prévia sem novo upload
3. `POST /api/import/check` marca as linhas já importadas
4. `POST /api/classify/suggest` roda o classificador; sugestões aparecem no painel flutuante
   (aceitar/negar individualmente ou em lote) — nunca são aplicadas automaticamente
5. `POST /api/import` grava só o que estiver selecionado

**Sinal do valor** (`SignMode`): `auto` (coluna de natureza → nome do arquivo → sinal da célula) ·
`despesa` (tudo −) · `receita` (tudo +) · `arquivo` (respeita a planilha).
Layout com colunas separadas de débito/crédito: a coluna preenchida define o sinal.

## Classificador (`src/lib/classifier.ts`)

Jaccard puro, sem IA:
```
tokenize(memo): lowercase → remove dígitos → remove não-letras → tokens > 2 chars
jaccardSimilarity(A, B): |A∩B| / |A∪B|
```
Threshold ≥ 0.35 contra o histórico do banco; ≥ 0.5 para propagar dentro do próprio arquivo.
Transferências ficam fora do classificador.

## DRE (`src/lib/dre.ts`)

`calcDRE()` agrupa por `account.dreGroup` e devolve `DRELine[]` plano
(`section | group | account | subtotal | breakeven | transfer`).

```
Receita Operacional
- Deduções sobre a Venda
= Receita Líquida
- Custo do Produto/Serviço - Despesa Variável
= Margem de Contribuição            ← PEO
- Despesas Administrativas / Financeiras / com Pessoal / com Marketing / Comerciais
= Lucro Operacional (EBIT)          ← PEI
- Investimentos
= Lucro após Investimentos          ← PEF
+ Receita Não Operacional - Despesas Não Operacionais
= Lucro antes dos Impostos
- Impostos
= Lucro Líquido
```

Os grupos válidos de `dreGroup` estão em `DRE_GROUPS` (`src/lib/dre.ts`) — string exata,
case-sensitive. `Transferência entre Contas` (type `NEUTRO`) é informativo e nunca soma.

**Duas proteções contra valor sumido da DRE** (um `dreGroup` com acento ou grafia diferente
não casa com nenhum grupo e sairia de todos os subtotais sem aviso):
1. `POST/PUT /api/accounts` rejeitam com 400 qualquer `dreGroup` fora de `ALL_DRE_GROUPS`
   ou `type` fora de `ACCOUNT_TYPES`.
2. `calcDRE()` soma o que sobrou em `naoMapeado` e emite as linhas
   **"⚠ Contas fora da estrutura da DRE"** no fim do relatório — valor visível, fora dos totais.

Ao mexer em `DRE_GROUPS`, o import (`src/app/api/accounts/import/route.ts`) resolve sinônimos
e acentos via `resolveGroup()` — atualizar o `SECTION_MAP` de lá também.

## UI

Sem biblioteca de componentes — estilos inline + classes de `globals.css`:
`.card`, `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-sm`, `.metric-card`,
`.metric-label`, `.metric-value`, `.metric-accent`, `.form-input`, `.form-select`, `.form-label`,
`.upload-zone`, `.table-wrap`, `.badge-*`, `.toast`, `.page-header`, `.page-title`, `.grid-2`.

Marca: fonte **Bricolage Grotesque** (`--font-title`), **Montserrat** (`--font-sub`),
amarelo `#eaca2d` (`--brave-yellow`), escuro `#2b2d42` (`--brave-dark`).

## Origem

Estrutura de DRE, classificador e padrões de UI replicados do sistema **Prism · Tio Chico Shop**
(`../../Tio Chico Shop/prism-mais-vidas`). Diferenças: aqui o import é de planilhas de contas
pagas/recebidas (não OFX/PDF de cartão) e o escopo é Dashboard + Lançamentos + DRE.
