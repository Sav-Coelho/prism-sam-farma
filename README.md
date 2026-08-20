# Prism · Sam Farma

Sistema de gestão financeira da Sam Farma: importa as planilhas de contas pagas e recebidas,
classifica cada lançamento no plano de contas e gera a **DRE** e o **Dashboard** do período.

Mesma estrutura de DRE do Prism (Tio Chico Shop): margem de contribuição, custos fixos,
investimentos, não operacionais, impostos e os três pontos de equilíbrio (PEO, PEI, PEF).

## Telas

- **Dashboard** — KPIs (receita bruta/líquida, margem de contribuição, lucro operacional,
  resultado líquido), custos variáveis e fixos, ponto de equilíbrio, margem de segurança,
  composição de despesas e evolução mensal. Abre em Consolidado Anual.
- **Lançamentos** — import de planilha de contas pagas/recebidas com prévia e classificação,
  lançamento manual e a tabela de lançamentos do mês.
- **DRE** — demonstração estruturada com coluna AV% (análise vertical), pontos de equilíbrio
  com e sem impostos, comparativo anual e histórico mensal.
- **Configuração → Plano de Contas / Unidades** — cadastros que alimentam as três telas acima.

## Como rodar

```bash
npm install
```

Crie o `.env` a partir do `.env.example` com as URLs do banco Neon:

```
DATABASE_URL="postgresql://...-pooler.../neondb?sslmode=require"
DIRECT_URL="postgresql://.../neondb?sslmode=require"
```

Aplique o schema e suba o servidor:

```bash
npm run db:push
npm run dev
```

Abra http://localhost:3000 — a raiz redireciona para `/dashboard`.

## Primeiros passos no sistema

1. **Unidades** — crie a unidade (ex.: `SAM FARMA`) e a conta bancária/caixa.
2. **Plano de Contas** — importe o plano (Excel/CSV) ou cadastre as contas manualmente.
   O botão *Modelo CSV* baixa um exemplo com as colunas aceitas.
3. **Lançamentos** — envie a planilha de contas pagas e a de contas recebidas. Confira a
   prévia, classifique as linhas (o classificador sugere com base no histórico) e salve.
4. **DRE / Dashboard** — o resultado aparece já classificado por grupo.

> Lançamentos sem conta do plano **não entram na DRE** — o card "Sem classificação"
> na tela de Lançamentos mostra quantos ainda faltam.
>
> Se alguma conta ficar com um Grupo DRE que o sistema não reconhece, o valor **não é
> descartado em silêncio**: aparece no fim da DRE como "⚠ Contas fora da estrutura da DRE",
> fora dos totais, para você corrigir o grupo no plano de contas.

## Importação de planilhas

Aceita `.xlsx`, `.xls` e `.csv`. As colunas de data, descrição e valor são detectadas
automaticamente (aceita cabeçalho em qualquer linha das 15 primeiras, valores em formato
brasileiro, parênteses como negativo e datas `DD/MM/AAAA` ou `AAAA-MM-DD`).

Em **Ajustar colunas e sinais** você pode:
- remapear qualquer coluna, incluindo colunas separadas de débito e crédito;
- definir o sinal dos valores (tudo saída, tudo entrada, automático ou o sinal da planilha);
- escolher a competência na DRE: a data de cada linha ou todo o lote no mês selecionado.

Reimportar o mesmo arquivo não duplica nada — cada linha tem uma chave única e as repetidas
aparecem marcadas como *já importado*.

## Deploy

Vercel. O build roda `prisma generate && prisma db push && next build`, então as duas
variáveis de ambiente precisam estar configuradas no projeto Vercel.

---

Desenvolvido por Delfos Research LTDA — Uso Restrito
