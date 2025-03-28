const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const WebSocket = require('ws');
const path = require('path');

// Chemin vers le fichier proto
const PROTO_PATH = path.join(__dirname, 'chat.proto');

// Chargement du fichier proto
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
});

const chatProto = grpc.loadPackageDefinition(packageDefinition).chat;

// Fonction pour créer un client gRPC
function createGrpcClient() {
    return new chatProto.ChatService('localhost:50051',
    grpc.credentials.createInsecure());
}

// Création d'un serveur WebSocket servant de reverse proxy
const wss = new WebSocket.Server({ port: 8080 });
console.log('Reverse proxy WebSocket en écoute sur ws://localhost:8080');

wss.on('connection', (ws) => {
    console.log('Nouveau client WebSocket connecté.');
    
    // Pour chaque client, créer un stream gRPC bidirectionnel
    const grpcClient = createGrpcClient();
    const grpcStream = grpcClient.Chat();
    
    // Relayer les messages reçus du serveur gRPC vers le client WebSocket
    grpcStream.on('data', (chatStreamMessage) => {
        console.log('Message reçu du serveur gRPC:', chatStreamMessage);
        ws.send(JSON.stringify(chatStreamMessage));
    });
    
    grpcStream.on('error', (err) => {
        console.error('Erreur dans le stream gRPC:', err);
        ws.send(JSON.stringify({ error: err.message }));
    });
    
    grpcStream.on('end', () => {
        console.log('Stream gRPC terminé.');
        ws.close();
    });
    
    // Relayer les messages reçus du client WebSocket vers le serveur gRPC
    ws.on('message', (message) => {
        try {
            const parsed = JSON.parse(message);
            console.log('Message reçu du client WebSocket:', parsed);
            
            // Vérifier si c'est une demande d'historique de chat
            if (parsed.action === 'getChatHistory') {
                console.log('Demande d\'historique de chat pour la salle:', parsed.room_id);
                
                const grpcClient = createGrpcClient();
                grpcClient.GetChatHistory({
                    room_id: parsed.room_id,
                    limit: parsed.limit || 50
                }, (err, response) => {
                    if (err) {
                        console.error('Erreur lors de la récupération de l\'historique:', err);
                        ws.send(JSON.stringify({
                            action: 'chatHistory',
                            error: err.message
                        }));
                    } else {
                        console.log(`Historique récupéré: ${response.messages.length} messages`);
                        ws.send(JSON.stringify({
                            action: 'chatHistory',
                            messages: response.messages
                        }));
                    }
                });
            } 
            // Si c'est une demande d'information utilisateur
            else if (parsed.action === 'getUser') {
                console.log('Demande d\'informations utilisateur pour:', parsed.user_id);
                
                const grpcClient = createGrpcClient();
                grpcClient.GetUser({
                    user_id: parsed.user_id
                }, (err, response) => {
                    if (err) {
                        console.error('Erreur lors de la récupération de l\'utilisateur:', err);
                        ws.send(JSON.stringify({
                            action: 'userData',
                            error: err.message
                        }));
                    } else {
                        console.log('Informations utilisateur récupérées');
                        ws.send(JSON.stringify({
                            action: 'userData',
                            user: response.user
                        }));
                    }
                });
            }
            // Sinon, c'est un message de chat standard
            else if (parsed.chat_message) {
                grpcStream.write(parsed);
            }
            else {
                console.warn('Format de message non reconnu:', parsed);
                ws.send(JSON.stringify({ error: 'Format de message non reconnu' }));
            }
        } catch (err) {
            console.error('Erreur lors de la conversion du message JSON:', err);
            ws.send(JSON.stringify({ error: 'Format JSON invalide' }));
        }
    });
    
    ws.on('close', () => {
        console.log('Client WebSocket déconnecté, fermeture du stream gRPC.');
        grpcStream.end();
    });
});