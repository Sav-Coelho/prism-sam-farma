# Prism · Sam Farma

Sistema de gestão financeira da Sam Farma (Farma & Farma — Goiana e Igarassu).
Reproduz a **DRE Gerencial em regime de caixa** que a empresa mantinha em planilha, a partir
dos arquivos que o ERP já exporta.

**Produção:** https://prism-sam-farma.vercel.app

## A rotina do analista

1. **Contas a Pagar** — exporta do ERP e sobe em *Lançamentos*. Cada título já vem com a coluna
   *Plano de Contas*, que é a chave do De-Para: a classificação na DRE é automática.
   - título **pago** → entra na DRE pela **data de pagamento**
   - título **pendente** → vai para o **fluxo projetado** pela **data de vencimento**
2. **Recebidos e Recebíveis** — sobe a planilha de recebimentos por canal.
   - *recebido* → entra na DRE · *a receber* → alimenta o fluxo projetado
3. **Conta nova no ERP?** Entra sozinha como `⚠ A Classificar`, fica **fora do resultado** e
   aparece destacada em *Plano de Contas* para definir a categoria. Nada é classificado errado
   em silêncio, e nada some da DRE.

Não é preciso mapear colunas nem classificar lançamento a lançamento: o sistema reconhece
qual é o arquivo pelo próprio cabeçalho.

## Telas

| Tela | O que traz |
|---|---|
| **Dashboard** | KPIs (receita, margem de contribuição, lucro operacional, EBITDA, lucro líquido), composição de despesas, ponto de equilíbrio e evolução mensal |
| **Lançamentos** | Importação dos dois arquivos, prévia antes de gravar e a tabela do período |
| **DRE** | A DRE gerencial completa com AV%, memo de CAPEX/A Classificar, comparativo anual e histórico mensal |
| **Fluxo Projetado** | Entradas e saídas previstas por mês de vencimento, saldo acumulado, vencidos em aberto e maiores compromissos |
| **Plano de Contas · De-Para** | Cada conta do ERP → categoria da DRE. Filtro "só a classificar" |
| **Unidades** | Unidades e contas bancárias |

## Estrutura da DRE

```
(+) FONTES DE RECEITA OPERACIONAL BRUTA     (por canal de recebimento)
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
MEMO (fora do resultado): CAPEX · ⚠ A Classificar · Transferências
```

Conferido contra a planilha do cliente de julho/2026 — as 13 linhas batem ao centavo.

## Como rodar

```bash
npm install
npm run dev
```

O `.env` precisa de `DATABASE_URL` e `DIRECT_URL` (Neon) — ver `.env.example`.
Deploy sai de `git push origin main`; o build roda `prisma generate && prisma db push && next build`.

## Carga inicial

O histórico de jan–jul/2026 veio do arquivo `DRE_Gerencial_SamFarma_AtéJulho2026.xlsx`
(abas `De-Para`, `Base_Pagamentos` e `Base_Recebimentos`) pelo script:

```bash
npx tsc scripts/backfill.ts src/lib/*.ts --outDir .backfill-out --module commonjs --target es2019 --moduleResolution node --esModuleInterop --skipLibCheck
node .backfill-out/scripts/backfill.js "<pasta com os xlsx>"
```

Reexecutar é seguro: tudo é gravado com chave única e `skipDuplicates`.

---

Desenvolvido por Delfos Research LTDA — Uso Restrito
