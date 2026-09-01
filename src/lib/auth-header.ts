/**
 * Cabeçalho interno que carrega o id do usuário JÁ VALIDADO pelo proxy até a
 * página, dentro da mesma requisição.
 *
 * Por que existe: `supabase.auth.getUser()` não é validação local de token — é
 * uma chamada HTTP à API de Auth, medida em ~200ms (mediana; picos de 470ms).
 * O proxy faz essa chamada em TODA requisição, confere o usuário e joga o
 * resultado fora; a página então chamava de novo. Eram ~200ms pagos duas vezes
 * em toda navegação, em toda aba — a maior parcela isolada do tempo de troca de
 * aba, e o motivo de a lentidão ser geral e não só da dashboard.
 *
 * SEGURANÇA — a regra que sustenta isso: o proxy APAGA o valor recebido do
 * cliente antes de escrever o seu. Um cabeçalho forjado na requisição nunca
 * sobrevive ao proxy, e o matcher dele cobre todas as rotas da aplicação (só
 * ficam de fora `_next/static`, `_next/image`, `favicon.ico` e `.png`, que não
 * são Server Components e não leem perfil). Quem confia neste cabeçalho está
 * confiando na validação que o proxy acabou de fazer, não no cliente.
 *
 * Se algum dia o matcher do proxy encolher, esta garantia cai junto — o
 * fallback em `getAuthUser()` volta a chamar a rede, então falha para o lado
 * seguro (lento), nunca para o lado inseguro.
 */
export const CABECALHO_USUARIO = 'x-fv-user-id'

/**
 * Caminho da requisição, para o layout saber QUAL tela está sendo aberta.
 *
 * O layout de `(sistema)` roda em toda página e é o único ponto por onde todas
 * passam — é lá que a operadora é barrada. Só que Server Component não enxerga
 * o pathname sozinho, então o proxy escreve aqui.
 *
 * Vale a mesma regra do cabeçalho de usuário: o proxy APAGA o que veio do
 * cliente antes de escrever o seu. Um caminho forjado não sobrevive.
 *
 * E o layout nega quando o cabeçalho falta. Se o matcher do proxy encolher e
 * ele parar de chegar, a operadora perde acesso — falha para o lado seguro.
 */
export const CABECALHO_CAMINHO = 'x-fv-pathname'
