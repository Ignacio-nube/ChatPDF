import { useState, useEffect, useRef } from 'react';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory';
import { OpenAIEmbeddings, ChatOpenAI } from '@langchain/openai';
import { createRetrievalChain } from '@langchain/classic/chains/retrieval';
import { createStuffDocumentsChain } from '@langchain/classic/chains/combine_documents';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { 
  Box, 
  Container, 
  VStack, 
  HStack, 
  Input, 
  Text, 
  Heading, 
  Spinner, 
  IconButton,
  Separator,
  Circle,
  Flex,
  Button
} from '@chakra-ui/react';
import { motion, AnimatePresence } from 'framer-motion';
import { LuSend, LuFileText, LuBot, LuTrash2, LuUpload } from 'react-icons/lu';
import { ColorModeButton } from '@/components/ui/color-mode';
import { Tooltip } from '@/components/ui/tooltip';

// Importación correcta de pdfjs-dist para el navegador
import * as pdfjs from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

// Configuración del worker de pdfjs-dist
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Componentes animados con Framer Motion
const MotionBox = motion(Box);

// Componente para el efecto de "Tetris Invertido" (Bloque único)
const TetrisResponse = ({ text }: { text: string }) => {
  return (
    <Box px={4} w="full">
      <motion.div
        initial={{ y: 500, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ 
          type: "spring", 
          damping: 15,
          stiffness: 100
        }}
      >
        <Box 
          p={6} 
          bg="blue.600" 
          color="white" 
          borderRadius="xl"
          fontWeight="medium"
          boxShadow="2xl"
          border="2px solid"
          borderColor="blue.400"
          fontSize="lg"
          lineHeight="tall"
        >
          {text}
        </Box>
      </motion.div>
    </Box>
  );
};

const ChatPDF = () => {
  // Estados de la aplicación
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<{ role: 'user' | 'assistant', text: string }[]>([]);
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  
  // Referencias
  const vectorStoreRef = useRef<MemoryVectorStore | null>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Efecto para hacer scroll automático al final cuando hay nuevas respuestas
  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, isProcessing]);

  // Función central para procesar el PDF (ya sea local o subido)
  const processPDF = async (arrayBuffer: ArrayBuffer, name: string) => {
    try {
      setIsLoadingPdf(true);
      setError(null);
      setFileName(name);
      
      // Cargar el PDF usando pdfjs directamente
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      let fullText = '';
      
      // Extraer texto de cada página
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const strings = content.items.map((item: any) => item.str);
        fullText += strings.join(' ') + '\n';
      }

      if (!fullText.trim()) {
        throw new Error('El PDF parece estar vacío o no contiene texto extraíble.');
      }

      // Crear un documento base para LangChain
      const docs = [{
        pageContent: fullText,
        metadata: { source: name }
      }];

      // 2. Dividir el texto en fragmentos (chunks) manejables
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
      });
      const splitDocs = await splitter.splitDocuments(docs);

      // 3. Vectorizar los fragmentos y guardarlos en memoria
      const embeddings = new OpenAIEmbeddings({
        apiKey: 'proxy',
        configuration: {
          baseURL: `${window.location.origin}/api/v1`,
          dangerouslyAllowBrowser: true
        }
      });

      const vectorStore = await MemoryVectorStore.fromDocuments(
        splitDocs,
        embeddings
      );

      vectorStoreRef.current = vectorStore;
      setIsLoadingPdf(false);
    } catch (err) {
      console.error("Error al procesar PDF:", err);
      setError(err instanceof Error ? err.message : 'Error desconocido al procesar el PDF');
      setIsLoadingPdf(false);
    }
  };

  // Efecto para inicializar con el PDF por defecto al cargar el componente
  useEffect(() => {
    const initDefaultPDF = async () => {
      try {
        const response = await fetch('/documento.pdf');
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          await processPDF(arrayBuffer, 'documento.pdf');
        }
      } catch (err) {
        console.log("No se encontró documento.pdf por defecto, esperando subida del usuario.");
      }
    };

    initDefaultPDF();
  }, []);

  // Manejador de subida de archivos
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      setError('Por favor, sube solo archivos PDF.');
      return;
    }

    const arrayBuffer = await file.arrayBuffer();
    await processPDF(arrayBuffer, file.name);
    
    // Limpiar el historial al cambiar de documento para evitar confusiones de contexto
    setHistory([]);
  };

  // Función para manejar el envío de preguntas
  const handleAsk = async () => {
    if (!input.trim() || !vectorStoreRef.current || isProcessing) return;

    const userQuestion = input.trim();
    setInput('');
    
    // Añadimos la pregunta del usuario al historial inmediatamente
    setHistory(prev => [...prev, { role: 'user', text: userQuestion }]);
    
    try {
      setIsProcessing(true);
      setError(null);

      // 4. Configurar el modelo de lenguaje (LLM)
      const llm = new ChatOpenAI({
        modelName: "gpt-4o-mini",
        temperature: 0.3,
        apiKey: 'proxy',
        configuration: {
          baseURL: `${window.location.origin}/api/v1`,
          dangerouslyAllowBrowser: true
        }
      });

      // Formatear el historial para el prompt
      const chatHistoryString = history
        .map(msg => `${msg.role === 'user' ? 'Usuario' : 'Asistente'}: ${msg.text}`)
        .join('\n');

      // Plantilla del prompt para el sistema RAG (Equilibrada con Memoria)
      const prompt = ChatPromptTemplate.fromTemplate(`
        Eres un asistente virtual amable y experto. Tu misión es ayudar al usuario a comprender el contenido del documento proporcionado.
        Tienes acceso al historial de la conversación actual para mantener el contexto.

        Instrucciones:
        1. Usa el contexto proporcionado para responder de manera precisa y prioritaria.
        2. Si la respuesta no está literal, pero se puede deducir lógicamente del contenido, ofrece una respuesta basada en esa deducción.
        3. Si el usuario te saluda o hace preguntas simples de cortesía, responde de forma amable y natural.
        4. Si la pregunta es sobre la utilidad o aplicación del contenido en otros contextos, intenta dar una respuesta razonada basada en lo que el documento describe.
        5. Solo si la información es completamente ajena al documento y no se puede inferir de ninguna manera, menciona que no dispones de esos detalles específicos en el texto.

        Historial de conversación:
        {chat_history}

        Contexto del documento:
        {context}

        Pregunta actual del usuario: {input}
      `);

      // Crear la cadena de procesamiento de documentos
      const combineDocsChain = await createStuffDocumentsChain({
        llm,
        prompt,
      });

      // Configurar el recuperador (retriever) desde el almacén de vectores
      const retriever = vectorStoreRef.current.asRetriever();

      // Crear la cadena de recuperación final
      const retrievalChain = await createRetrievalChain({
        combineDocsChain,
        retriever,
      });

      // 5. Generar la respuesta invocando la cadena
      const response = await retrievalChain.invoke({
        input: userQuestion,
        chat_history: chatHistoryString,
      });

      setHistory(prev => [...prev, { role: 'assistant', text: response.answer }]);
    } catch (err: any) {
      console.error("Error al generar respuesta:", err);
      
      // Intentar extraer un mensaje de error más descriptivo
      let errorMessage = 'Hubo un problema al conectar con OpenAI.';
      if (err.message) {
        if (err.message.includes('401')) errorMessage += ' (Error 401: API Key inválida o no configurada)';
        else if (err.message.includes('429')) errorMessage += ' (Error 429: Límite de cuota excedido)';
        else if (err.message.includes('500')) errorMessage += ' (Error 500: Error interno del servidor proxy)';
        else errorMessage += ` Detalle: ${err.message}`;
      }
      
      setError(errorMessage);
    } finally {
      setIsProcessing(false);
    }
  };

  const clearHistory = () => {
    setHistory([]);
    setError(null);
  };

  return (
    <Box minH="100vh" bg="bg" color="fg" transition="background 0.2s">
      <Container maxW="container.lg" py={10} centerContent>
        {/* Encabezado */}
        <MotionBox 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          mb={10}
          w="full"
        >
          <Flex justify="space-between" align="center">
            <HStack gap={4}>
              <Circle size="50px" bg="blue.600" color="white" boxShadow="0 0 20px rgba(49, 130, 206, 0.5)">
                <LuFileText size={24} />
              </Circle>
              <VStack align="start" gap={0}>
                <Heading size="xl" letterSpacing="tight">ChatPDF <Text as="span" color="blue.500">Tetris</Text></Heading>
                <Text fontSize="sm" color="fg.muted" fontWeight="medium">
                  {fileName ? `Documento: ${fileName}` : 'Sube tu pregunta, recibe bloques de conocimiento'}
                </Text>
              </VStack>
            </HStack>
            <HStack gap={3}>
              <input
                type="file"
                accept=".pdf"
                onChange={handleFileUpload}
                ref={fileInputRef}
                style={{ display: 'none' }}
              />
              <Button 
                variant="solid" 
                colorPalette="blue" 
                onClick={() => fileInputRef.current?.click()}
                size="sm"
                fontWeight="bold"
              >
                <LuUpload /> Subir PDF
              </Button>
              {history.length > 0 && (
                <Button 
                  variant="outline" 
                  colorPalette="red" 
                  onClick={clearHistory}
                  size="sm"
                  fontWeight="bold"
                >
                  <LuTrash2 /> Limpiar
                </Button>
              )}
              <ColorModeButton size="lg" variant="outline" borderRadius="full" />
            </HStack>
          </Flex>
          <Separator mt={6} opacity={0.2} />
        </MotionBox>

        {/* Área de Carga Inicial */}
        {isLoadingPdf && (
          <Flex direction="column" align="center" justify="center" py={20} gap={6}>
            <Spinner size="xl" color="blue.500" />
            <VStack gap={1}>
              <Text fontWeight="bold" fontSize="lg">Analizando {fileName || 'documento'}</Text>
              <Text fontSize="sm" color="fg.muted">Construyendo el almacén de vectores...</Text>
            </VStack>
          </Flex>
        )}

        {/* Mensajes de Error */}
        {error && (
          <Box p={4} bg="red.500/10" color="red.500" borderRadius="xl" mb={8} border="1px solid" borderColor="red.500/20" w="full">
            <HStack>
              <Text fontWeight="bold">Error:</Text>
              <Text fontSize="sm">{error}</Text>
            </HStack>
          </Box>
        )}

        {/* Input de Chat (Ahora arriba) */}
        {!isLoadingPdf && (
          <MotionBox 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            mb={10}
            w="full"
            maxW="700px"
            p={2} 
            bg="bg.panel" 
            borderRadius="2xl" 
            boxShadow="2xl"
            border="1px solid"
            borderColor="border"
          >
            <HStack gap={0}>
              <Input
                placeholder="Haz una pregunta al PDF..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
                variant="flushed"
                size="lg"
                px={6}
                disabled={isProcessing}
                _focus={{ outline: 'none', borderColor: 'blue.500' }}
              />
              <IconButton
                aria-label="Enviar"
                colorPalette="blue"
                variant="solid"
                onClick={handleAsk}
                disabled={!input.trim() || isProcessing}
                borderRadius="xl"
                size="lg"
                m={1}
              >
                <LuSend />
              </IconButton>
            </HStack>
          </MotionBox>
        )}

        {/* Visualización de Respuesta (Efecto Tetris Bloque Único) */}
        {!isLoadingPdf && (
          <Box w="full" minH="400px" display="flex" flexDirection="column">
            <VStack gap={8} w="full" align="stretch" mb={10}>
              <AnimatePresence mode="popLayout">
                {history.map((msg, index) => {
                  // Solo renderizamos las respuestas del asistente
                  if (msg.role === 'user') return null;
                  
                  // Buscamos la pregunta correspondiente (el mensaje anterior)
                  const userQuestion = history[index - 1]?.text || "Pregunta original";

                  return (
                    <Tooltip 
                      key={`${index}-${msg.text.substring(0, 10)}`}
                      content={
                        <VStack align="start" gap={1} p={1}>
                          <Text fontWeight="bold" fontSize="xs" color="blue.300">TU PREGUNTA:</Text>
                          <Text fontSize="sm">{userQuestion}</Text>
                        </VStack>
                      }
                      showArrow
                    >
                      <Box cursor="help">
                        <TetrisResponse text={msg.text} />
                      </Box>
                    </Tooltip>
                  );
                })}
              </AnimatePresence>
            </VStack>
            
            {history.length === 0 && !isProcessing && (
              <Flex direction="column" align="center" justify="center" flex={1} opacity={0.3}>
                <LuBot size={80} />
                <Text mt={6} fontSize="xl" fontWeight="medium">Esperando tu pregunta...</Text>
                <Text mt={2} fontSize="sm">Las respuestas aparecerán como bloques. Pasa el mouse sobre ellos para ver tu pregunta.</Text>
              </Flex>
            )}
            
            {isProcessing && (
              <Flex direction="column" align="center" justify="center" py={10} gap={4}>
                <HStack gap={2}>
                  {[0, 0.2, 0.4].map((delay) => (
                    <motion.div
                      key={delay}
                      style={{ width: 12, height: 12, backgroundColor: '#3182ce', borderRadius: '2px' }}
                      animate={{ y: [0, -20, 0], opacity: [0.5, 1, 0.5] }}
                      transition={{ repeat: Infinity, duration: 0.8, delay, repeatType: "loop" } as any}
                    />
                  ))}
                </HStack>
                <Text fontWeight="bold" color="blue.500" letterSpacing="widest">PROCESANDO...</Text>
              </Flex>
            )}
            <div ref={scrollEndRef} />
          </Box>
        )}
      </Container>
    </Box>
  );
};

export default ChatPDF;

