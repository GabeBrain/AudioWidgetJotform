function onJotformReady() {
    JFCustomWidget.subscribe("ready", function(){
        
        // --- ELEMENTOS DA INTERFACE ---
        const statusContainer = document.getElementById('status-container');
        const statusText = document.getElementById('status-text');
        const startButton = document.getElementById('startButton');
        const stopButton = document.getElementById('stopButton');

        // --- CONFIGURAÇÃO DO SUPABASE ---
        const SUPABASE_URL = 'https://mcsiygkjmwhyvaqroddi.supabase.co';
        const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jc2l5Z2tqbXdoeXZhcXJvZGRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYxODMyNDUsImV4cCI6MjA3MTc1OTI0NX0.GDCe18wOgb9Sz0UDrINUXDKE3wEcOJuTlyRIlaU2pGs';
    
        const { createClient } = supabase;
        const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        let mediaRecorder;
        let audioChunks = [];

        // --- FUNÇÃO PARA ATUALIZAR A INTERFACE ---
        function updateUI(state, message) {
            statusContainer.className = `status-${state}`;
            statusText.textContent = message;

            startButton.disabled = !['ready', 'prompt'].includes(state);
            stopButton.disabled = state !== 'recording';
        }

        // --- LÓGICA PRINCIPAL DE VERIFICAÇÃO DE PERMISSÃO ---
        async function checkPermissions() {
            if (!navigator.permissions) {
                updateUI('prompt', 'Navegador não suporta API de permissões. Clique para iniciar.');
                return;
            }
            try {
                const permissionStatus = await navigator.permissions.query({ name: 'microphone' });

                if (permissionStatus.state === 'granted') {
                    updateUI('ready', 'Status: Pronto para gravar!');
                } else if (permissionStatus.state === 'prompt') {
                    updateUI('prompt', 'Status: Requer permissão do microfone.');
                } else if (permissionStatus.state === 'denied') {
                    updateUI('denied', 'Status: Permissão negada. Habilite o microfone nas configurações do site.');
                }

                // Observa mudanças na permissão (ex: o usuário muda nas configs)
                permissionStatus.onchange = () => checkPermissions();

            } catch (err) {
                console.error("Erro ao checar permissões:", err);
                updateUI('denied', 'Erro ao verificar permissões. Verifique o console.');
            }
        }

        // --- LÓGICA DE GRAVAÇÃO ---
        const startRecording = async () => {
            updateUI('recording', 'Status: Solicitando permissão...');
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream);
                mediaRecorder.ondataavailable = event => audioChunks.push(event.data);
                mediaRecorder.onstop = async () => {
                    updateUI('ready', 'Status: Processando e fazendo upload...');
                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    const fileName = `gravacao-${Date.now()}.webm`;

                    const { data, error } = await supabaseClient.storage.from('audio-auditoria').upload(fileName, audioBlob);
                    
                    if (error) { throw error; }

                    const { data: { publicUrl } } = supabaseClient.storage.from('audio-auditoria').getPublicUrl(fileName);
                    updateUI('ready', 'Upload Concluído!');
                    JFCustomWidget.sendSubmit({ valid: true, value: publicUrl });
                };
                
                audioChunks = [];
                mediaRecorder.start();
                updateUI('recording', 'Status: Gravando... 🔴');
            } catch (err) {
                console.error("ERRO AO INICIAR GRAVAÇÃO:", err);
                // Se o erro for de permissão negada, o checkPermissions já terá atualizado a UI
                if(err.name !== 'NotAllowedError') {
                    updateUI('denied', `Erro: ${err.name}`);
                } else {
                    checkPermissions(); // Re-verifica para mostrar status 'denied'
                }
            }
        };

        const stopRecording = () => {
            if (mediaRecorder) mediaRecorder.stop();
        };
        
        // --- INICIALIZAÇÃO ---
        startButton.addEventListener('click', startRecording);
        stopButton.addEventListener('click', stopRecording);
        checkPermissions(); // Verifica as permissões assim que o widget carrega
    });
}