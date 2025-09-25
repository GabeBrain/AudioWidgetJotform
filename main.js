function onJotformReady() {
    
    // --- MUDANÇA PRINCIPAL: INICIALIZAÇÃO DO CLIENTE NO ESCOPO SUPERIOR ---
    // Garante que a variável supabaseClient exista durante todo o ciclo de vida do widget.
    const SUPABASE_URL = 'https://mcsiygkjmwhyvaqroddi.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jc2l5Z2tqbXdoeXZhcXJvZGRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYxODMyNDUsImV4cCI6MjA3MTc1OTI0NX0.GDCe18wOgb9Sz0UDrINUXDKE3wEcOJuTlyRIlaU2pGs';
    
    const { createClient } = supabase;
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    JFCustomWidget.subscribe("ready", function(){
        
        const statusDiv = document.getElementById('status');
        statusDiv.textContent = 'Status: Ocioso';

        const startButton = document.getElementById('startButton');
        const stopButton = document.getElementById('stopButton');
        
        let mediaRecorder;
        let audioChunks = [];

        const startRecording = async () => {
            statusDiv.textContent = 'Status: Solicitando permissão...';
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream);
                
                mediaRecorder.ondataavailable = event => {
                    audioChunks.push(event.data);
                };

                mediaRecorder.onstop = async () => {
                    statusDiv.textContent = 'Status: Processando e fazendo upload...';
                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    const fileName = `gravacao-${Date.now()}.webm`;

                    // Agora 'supabaseClient' estará definido e acessível aqui.
                    const { data, error } = await supabaseClient.storage.from('audio-auditoria').upload(fileName, audioBlob);
                    
                    if (error) { throw error; }
                    
                    const { data: { publicUrl } } = supabaseClient.storage.from('audio-auditoria').getPublicUrl(fileName);

                    statusDiv.textContent = `Status: Upload Concluído!`;
                    JFCustomWidget.sendSubmit({ valid: true, value: publicUrl });
                };

                audioChunks = [];
                mediaRecorder.start();
                statusDiv.textContent = 'Status: Gravando... 🔴';
                startButton.disabled = true;
                stopButton.disabled = false;

            } catch (err) {
                console.error("Erro ao iniciar a gravação:", err);
                statusDiv.textContent = `Erro: ${err.name}. Verifique o console.`;
            }
        };

        const stopRecording = () => {
            if (mediaRecorder) {
                mediaRecorder.stop();
                startButton.disabled = false;
                stopButton.disabled = true;
            }
        };
        
        startButton.addEventListener('click', startRecording);
        stopButton.addEventListener('click', stopRecording);

    });
}