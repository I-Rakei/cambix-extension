# Cambix para Chrome e Edge

Extensão Manifest V3 para simular compras e converter preços em USD, ZAR, EUR, GBP e CAD para Meticais. A extensão consulta `https://cambix-server.rakei.co.za/api/bancomoc/exchangerates-weekly`, o mesmo destino que o frontend Cambix usa através da sua rota `/api/bancomoc/exchangerates-weekly`.

## Instalação

1. Abra `chrome://extensions` ou `edge://extensions`.
2. Ative o modo de programador.
3. Clique em **Carregar sem compactação** e selecione esta pasta `extension`.

Clique no ícone da extensão para abrir a barra lateral. O painel usa Inter e permite escolher entre os modos claro e escuro. A calculadora oferece as taxas de mercado, BIM e BCI num menu suspenso. Em páginas web, use **Converter preços** para acrescentar o valor estimado em MZN ao lado de cada preço encontrado. Depois da primeira conversão, mudar a taxa no menu atualiza automaticamente os preços da página. **Reverter** restaura o texto original. A deteção automática apresenta um convite na página; pode desligá-la na barra lateral.

As taxas são guardadas durante uma hora. Quando o servidor falha, a extensão usa a última taxa guardada e identifica-a como antiga. Sem taxa guardada, a conversão fica indisponível. As margens BIM (1.065207) e BCI (1.044415) coincidem com `cambix/services/api.js`.

O detetor reconhece formatos de preços usados em lojas como Takealot, Amazon.co.za, Vinted, Bob Shop, eBay, MRP, Makro, Evetech e Amazon.com. No Takealot, também reconhece preços "From R", preços com desconto e preços em que o símbolo e o número estão em elementos separados. Preços anteriores riscados não são convertidos. Também funciona em outras lojas que mostram preços identificados por R, $, €, £ ou códigos de moeda. Para etiquetas de preço sem símbolo, usa a moeda declarada pela página ou a região do site. Preços carregados depois da abertura da página são detetados e, se a página já estiver convertida, recebem a conversão automaticamente.

Preços em imagens, canvas e campos editáveis não são detetados. O símbolo `$` é interpretado como USD. O botão na barra lateral faz uma nova procura quando necessário.

Inter é distribuída sob a SIL Open Font License; consulte `fonts/OFL.txt`.
