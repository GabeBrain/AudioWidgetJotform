// --- CONFIGURAÇÃO DO SUPABASE ---
        // const SUPABASE_URL = 'https://mcsiygkjmwhyvaqroddi.supabase.co';
        // const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jc2l5Z2tqbXdoeXZhcXJvZGRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYxODMyNDUsImV4cCI6MjA3MTc1OTI0NX0.GDCe18wOgb9Sz0UDrINUXDKE3wEcOJuTlyRIlaU2pGs';

function onJotformReady() {
    JFCustomWidget.subscribe("ready", function(){
        
        const permissionStep = document.getElementById('permission-step');
        const recordingStep = document.getElementById('recording-step');
        const checkPermissionButton = document.getElementById('checkPermissionButton');
        const startButton = document.getElementById('startButton');
        const stopButton = document.getElementById('stopButton');
        const statusContainer = document.getElementById('status-container');
        const statusText = document.getElementById('status-text');

        // ... (configuração do supabase não muda) ...
        const SUPABASE_URL = 'https://mcsiygkjmwhyvaqroddi.supabase.co';
        const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jc2l5Z2tqbXdoeXZhcXJvZGRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYxODMyNDUsImV4cCI6MjA3MTc1OTI0NX0.GDCe18wOgb9Sz0UDrINUXDKE3wEcOJuTlyRIlaU2pGs';

        const { createClient } = supabase;
        const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        let mediaRecorder;
        let audioChunks = [];

        function updateUI(message, stateClass) {
            statusText.textContent = message;
            statusContainer.className = `status-${stateClass}`;
        }

        // --- LÓGICA DE CLIQUE COM DIAGNÓSTICO ---
        checkPermissionButton.addEventListener('click', async () => {
            
            // PASSO 1: Feedback Imediato ao Clique
            updateUI('Botão clicado! Tentando checar permissões...', 'info');
            console.log("O evento de clique FOI registrado.");

            try {
                // PASSO 2: A chamada que provavelmente está sendo bloqueada
                console.log("Tentando executar navigator.permissions.query...");
                const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
                
                // Se o código chegar aqui, a chamada funcionou
                console.log("navigator.permissions.query executado com sucesso. Estado:", permissionStatus.state);
                
                if (permissionStatus.state === 'granted') {
                    updateUI('Permissão já concedida. Pronto para gravar.', 'success');
                    permissionStep.classList.add('hidden');
                    recordingStep.classList.remove('hidden');
                } else if (permissionStatus.state === 'prompt') {
                    updateUI("Permissão necessária. Clique em 'Iniciar Gravação' para solicitar.", 'info');
                    permissionStep.classList.add('hidden');
                    recordingStep.classList.remove('hidden');
                } else if (permissionStatus.state === 'denied') {
                    updateUI('Permissão negada. Habilite o microfone nas configurações do site.', 'error');
                    checkPermissionButton.disabled = true;
                }
            } catch (err) {
                // PASSO 3: Se a chamada for bloqueada e gerar um erro, veremos aqui
                console.error("FALHA: A chamada navigator.permissions.query() foi bloqueada e gerou um erro:", err);
                updateUI(`FALHA: A API de permissões foi bloqueada.`, 'error');
            }
        });

        // O resto do código permanece o mesmo...
        startButton.addEventListener('click', async () => {
            // ... (lógica de gravação) ...
        });

        stopButton.addEventListener('click', () => {
            if (mediaRecorder) mediaRecorder.stop();
        });
    });
}