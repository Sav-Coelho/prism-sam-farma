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
- `status` — REALIZADO (entra na DRE) ou PENDENTE (só fluxo projetado)
- `dueDate` — vencimento; competência do fluxo projetado
- `Account.erpKey` (unique) — caminho do "Plano de Contas" no ERP, chave do De-Para
- `transferToUnitId` / `transferToBankAccountId` — destino da transferência; a contrapartida
  de entrada é criada com `fitid = original + '_entrada'`

## Páginas

| Rota | Função |
|---|---|
| `/dashboard` | KPIs, composição de despesas, ponto de equilíbrio, evolução anual. Abre em Consolidado Anual (`month=0`) |
| `/lancamentos` | Sobe o Contas a Pagar do ERP e os Recebidos — reconhecimento automático do arquivo |
| `/dre` | DRE gerencial com AV%, memo, comparativo anual e histórico mensal |
| `/fluxo-projetado` | Entradas e saídas previstas por mês de vencimento, saldo acumulado, vencidos |
| `/plano-de-contas` | De-Para: conta do ERP → categoria da DRE, filtro "só a classificar" |
| `/unidades` | CRUD de unidades e contas bancárias |

## API

| Rota | Função |
|---|---|
| `GET /api/dre?month&year&unitId` | `{ dre, yearData }` — `month=0` = consolidado do ano |
| `GET/POST /api/transactions` | lista do período / lançamento manual |
| `PUT/DELETE /api/transactions/[id]` | classificar / excluir |
| `POST /api/import/parse` | multipart → matriz da planilha + colunas detectadas |
| `GET /api/fluxo?year&unitId` | fluxo projetado: pendentes por mês de vencimento |
| `POST /api/import/check` | `{ fitids }` → quais já existem no banco |
| `POST /api/import` | grava o lote (`createMany` + `skipDuplicates`) |
| `POST /api/classify/suggest` | `{ memos }` → sugestões Jaccard do histórico |
| `GET/POST /api/accounts`, `PUT/DELETE /api/accounts/[id]` | plano de contas |
| `POST /api/accounts/import` | Excel/CSV → plano de contas |
| `GET/POST /api/units`, `PUT/DELETE /api/units/[id]` | unidades |
| `POST /api/bank-accounts`, `PUT/DELETE /api/bank-accounts/[id]` | contas bancárias |

## Fluxo de import (`/lancamentos`)

O analista sobe dois arquivos; `POST /api/import/parse` reconhece qual é pelo cabeçalho
(`sniffKind` em `src/lib/erp-import.ts`):

1. **Contas a Pagar do ERP** (tem coluna "Plano de Contas") — `parsePagamentos()`.
   Cada título usa a coluna "Valor" (é a que a DRE do cliente soma, **não** "Valor Documento").
   `Status = Paga` + Data Pagamento → `status REALIZADO`, competência = data de pagamento.
   Caso contrário → `PENDENTE`, competência = vencimento (só fluxo projetado).
2. **Recebidos e Recebíveis** — `parseRecebimentos()`. Aceita o formato normalizado
   (Competência · Canal · Valor) e a matriz em blocos ("Contas a receber Agosto" com colunas
   recebidos/a receber). Cada bloco tem a janela de colunas limitada pelo bloco seguinte.
3. Qualquer outra planilha cai no fluxo genérico (`src/lib/import-mapper.ts`, mapeamento manual).

`POST /api/import` grava. `src/lib/erp-sync.ts` resolve os cadastros: chave do ERP → conta
(criando como `⚠ A Classificar` quando nova), apelido da unidade → `Unit`, canal → conta de receita.

**Datas:** o export do ERP vem em DD/MM/AAAA, mas a aba `Base_Pagamentos` do arquivo da DRE vem
em **M/D/AA** — o `scripts/backfill.ts` normaliza antes de parsear. Confirmado por 3.412 datas com
o segundo componente > 12 e pelo total de julho batendo com a planilha.

## Classificador (`src/lib/classifier.ts`)

Jaccard puro, sem IA:
```
tokenize(memo): lowercase → remove dígitos → remove não-letras → tokens > 2 chars
jaccardSimilarity(A, B): |A∩B| / |A∪B|
```
Threshold ≥ 0.35 contra o histórico do banco; ≥ 0.5 para propagar dentro do próprio arquivo.
Transferências ficam fora do classificador.

## DRE (`src/lib/dre.ts`)

Modelo do cliente, **regime de caixa** — só entra o que tem `status = REALIZADO`.

```
(+) FONTES DE RECEITA OPERACIONAL BRUTA   (uma conta por canal de recebimento)
(=) RECEITA OPERACIONAL BRUTA
(-) Deduções sobre Venda (exceto impostos)
(=) RECEITA LÍQUIDA
(-) Custos Variáveis Operacionais (CMV)
(=) MARGEM DE CONTRIBUIÇÃO / LUCRO BRUTO
(-) Administrativas  (-) Pessoal  (-) Logísticas  (-) Comerciais
(=) LUCRO OPERACIONAL
(-) Impostos
(=) EBITDA
(-) Financeiras  (-) Pró-Labore  (-) Despesas de Sócio
(=) LUCRO LÍQUIDO GERENCIAL
MEMO (nunca soma): CAPEX · ⚠ A Classificar · Transferências · fora da estrutura
```

As categorias estão em `CAT` e agrupadas por tipo em `DRE_GROUPS` — a string é exata e igual
à coluna "Categoria DRE" do De-Para do cliente. Conferido contra a planilha de julho/2026:
13 linhas batendo ao centavo (`scripts/conferir.ts`).

Os pontos de equilíbrio (PEO/PEI/PEF) **não** fazem parte do modelo do cliente — ficam num card
separado na DRE e no Dashboard. Base: custos fixos = admin + pessoal + logística + comercial.

**Duas proteções contra valor sumido da DRE:**
1. `POST/PUT /api/accounts` rejeitam com 400 categoria fora de `ALL_DRE_GROUPS`.
2. `calcDRE()` soma o que sobrou em `naoMapeado` e emite "⚠ Contas fora da estrutura da DRE"
   no memo — valor visível, fora dos totais. O mesmo vale para `⚠ A Classificar`.

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

## Duas regras que não estão escritas nos arquivos

Descobertas conferindo a DRE mês a mês contra a planilha — quebram os números em
silêncio se forem perdidas:

1. **Credor como chave do De-Para.** O ERP deixa "Plano de Contas" vazio em algumas
   linhas; nelas a chave é o **nome do credor** (14 das 191 chaves do cliente são
   fornecedores: SOLLARIS, ORIGO ENERGIA, SURI, TWL NEXCODE, VALIDA PIX...).
   `parsePagamentos()` faz `erpKey = plano || credor`. Sem isso, jan–jun ficavam com
   CMV e administrativas menores que a planilha.
2. **Canal de recebimento canônico.** A base histórica escreve "Recebimento RedeMatriz"
   e a planilha mensal "Cartão – Rede" para o mesmo canal. `canalCanonico()` normaliza
   para a grafia da aba "DRE Gerencial"; sem isso a linha de receita se parte no meio
   do ano e a análise horizontal marca −100%.

Scripts de manutenção em `scripts/`: `conferir.ts` (julho, 13 linhas), `conferir-ano.ts`
(7 meses × receita/CMV/margem), `religar-credor.ts` e `fundir-canais.ts` (correções
aplicadas ao que já está gravado), `backfill.ts` (carga inicial).
