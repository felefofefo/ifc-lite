# Documentação IFC

Montar e republicar um conjunto de pranchas a partir de vistas de um IFC vinculado. Guardar anotações, ambientes, áreas e pranchas no projeto de documentação. Usar a barra do Drawing para criar e editar anotações e o navegador de vistas para acessar os desenhos.

## 1. Cotas na barra do Drawing

- [x] Adaptar Medir para Cota linear. Reaproveitar snap, seleção e armazenamento. Oferecer cotas alinhadas, horizontais e verticais. Mostrar traços oblíquos nas pontas e o valor junto à linha. Aplicar a mesma geometria no SVG avulso, com texto e traços em milímetros de papel.
- [x] Coletar pontos por clique em cadeia e posicionar a linha de cota num último clique, com prévia e linhas de extensão. Permitir arrastar a cadeia depois de inserir.
- [x] Guardar novas cotas automaticamente por ID de vista salva ou pelo plano temporário.
- [ ] Ao recarregar um IFC revisado, resolver referências que ainda existam e marcar as que precisam de revisão.
- [ ] Levar as cotas para SVG de prancha, PDF vetorial e DXF. Verificar duas escalas, duas vistas salvas e exportação em lote, sem misturar anotações de vistas diferentes.

- [x] Exibir o check do Drawing no menu de Cota e editar o estilo Arquitetônico do projeto em Drawing → Anotações → Cotas. Compartilhar geometria gráfica e formatação com o SVG avulso.
- [x] Selecionar e mover o texto de um trecho individual no Drawing, com rotação no inspetor. Manter o deslocamento ao mover a cadeia.
- [x] Salvar tipos de cota por nome com cores e terminações independentes e atribuir um tipo por cadeia.
- [ ] Adicionar escolha de estilo por template e vista e as cotas Angular e Raio.

Pontos de partida no código: DrawingToolbar, useMeasure2D, drawing2DSlice, Drawing2DCanvas, savedSectionCutsStore e useDrawingExport. A geometria do primeiro passo está em dimension-line.ts.

## 2. Tags e símbolos

- [ ] Adicionar Tag à barra. Selecionar um elemento visível no Drawing e colocar o rótulo, com posição editável e linha de chamada opcional. Ler código, tipo ou propriedade IFC do elemento vinculado.
- [ ] Reutilizar o fluxo de seleção de ferramentas da barra e os componentes de menu do IFC Lite. Revisar Área, Texto e Nuvem à medida que suas funções forem cobertas. Manter acessíveis as anotações existentes durante a transição.
- [ ] Criar biblioteca de famílias de anotação com SVG local, prévia, ponto de inserção e campos dinâmicos. Permitir padrão pelo template e troca por vista ou instância. Começar com uma família de tag e uma de marcador de corte.
- [ ] Reaproveitar as linhas e os códigos de corte e elevação. Ligar cada chamada à vista de destino pelo ID e resolver código e número de prancha na publicação. Acrescentar chamadas de detalhe, eixos, símbolos gerais e notas com linha de chamada.
- [ ] Testar a atualização de propriedade após recarregar o modelo, uma referência removida e a numeração após mover a vista de destino de prancha.

## 3. Ambientes e áreas

- [ ] Ler IfcSpace com vínculo de modelo e GlobalId. Quando o IFC não trouxer o ambiente, reaproveitar a prévia do detector por pavimento para confirmar um recinto na planta. Permitir contorno editável para limites abertos ou virtuais.
- [ ] Usar código, nome e área do mesmo registro nas tags e nos quadros. Identificar a origem da área, declarada no IFC ou calculada pelo contorno.
- [ ] Permitir áreas com contorno próprio e agrupamento por pavimento, unidade ou categoria. Somar áreas úteis conforme o critério do quadro e manter a área bruta como medição própria.
- [ ] Testar uma planta com um ambiente importado e outro detectado. Após mover uma parede e recarregar o IFC, atualizar tag e quadro ou apontar o ambiente que precisa de revisão.

## 4. Pranchas e publicação

- [ ] Criar prancha com número, nome, formato, orientação e carimbo SVG com campos do projeto. Inserir múltiplas viewports, cada uma vinculada a uma vista salva, com posição, recorte e escala de publicação.
- [ ] Posicionar títulos de vista, quadros e legendas. Usar coordenadas de papel para tamanhos dos símbolos, margens e alinhamento. Usar a escala da viewport para transformar a geometria da vista.
- [ ] Atualizar as vistas e publicar pranchas e vistas avulsas em lote. Preservar a configuração de cada vista e conferir o resultado em PDF vetorial, SVG e DXF conforme o destino.
- [ ] Validar com uma prancha piloto contendo planta cotada, corte, detalhe vinculado e quadro de ambientes. Revisar o IFC, reabrir o projeto e republicar o mesmo conjunto.

Ferramentas de desenho livre e acabamento pontual seguem no CAD ou no Inkscape.
