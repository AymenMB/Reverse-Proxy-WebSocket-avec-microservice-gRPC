const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
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

// Définition d'un utilisateur administrateur de base
const admin = {
    id: "admin",
    name: "Grpc_Admin",
    email: "grpc_admin@mail.com",
    status: "ACTIVE",
};

// Stockage des messages en mémoire (pour l'historique)
const messageHistory = {};

// Implémentation de l'appel GetUser
function getUser(call, callback) {
    const userId = call.request.user_id;
    console.log(`Requête GetUser reçue pour id: ${userId}`);
    
    // Retourner un utilisateur fictif en se basant sur "admin" et en remplaçant l'id par celui fourni
    const user = { ...admin, id: userId };
    callback(null, { user });
}

// Implémentation de l'appel Chat (streaming bidirectionnel)
function chat(call) {
    console.log("Flux Chat démarré.");
    
    call.on('data', (chatStreamMessage) => {
        if (chatStreamMessage.chat_message) {
            const msg = chatStreamMessage.chat_message;
            console.log(`Message reçu de ${msg.sender_id}: ${msg.content}`);
            
            // Ajouter un horodatage au message
            const timestamp = new Date().toISOString();
            msg.timestamp = timestamp;
            
            // Sauvegarder le message dans l'historique
            if (!messageHistory[msg.room_id]) {
                messageHistory[msg.room_id] = [];
            }
            messageHistory[msg.room_id].push(msg);
            
            // Conserver au maximum les 100 derniers messages par salle
            if (messageHistory[msg.room_id].length > 100) {
                messageHistory[msg.room_id].shift();
            }
            
            // Création d'une réponse avec quelques modifications sur le message reçu
            const reply = {
                id: msg.id + "_reply",
                room_id: msg.room_id,
                sender_id: admin.name,
                content: "received at " + timestamp,
                timestamp: timestamp
            };
            
            // Sauvegarder également la réponse dans l'historique
            messageHistory[msg.room_id].push(reply);
            
            // On renvoie le message au client (écho)
            call.write({ chat_message: reply });
        }
    });
    
    call.on('end', () => {
        console.log("Fin du flux Chat.");
        call.end();
    });
}

// Nouvelle implémentation pour récupérer l'historique des messages
function getChatHistory(call, callback) {
    const roomId = call.request.room_id;
    const limit = call.request.limit || 50; // Valeur par défaut si non spécifiée
    
    console.log(`Requête GetChatHistory reçue pour la salle: ${roomId}, limite: ${limit}`);
    
    // Récupérer les messages de la salle demandée
    const messages = messageHistory[roomId] || [];
    
    // Retourner les N derniers messages (selon la limite)
    const limitedMessages = messages.slice(-limit);
    
    callback(null, { messages: limitedMessages });
}

// Démarrage du serveur gRPC
function main() {
    const server = new grpc.Server();
    server.addService(chatProto.ChatService.service, {
        GetUser: getUser,
        Chat: chat,
        GetChatHistory: getChatHistory
    });
    
    const address = '0.0.0.0:50051';
    server.bindAsync(address, grpc.ServerCredentials.createInsecure(), (error, port) => {
        if (error) {
            console.error("Erreur lors du binding du serveur :", error);
            return;
        }
        server.start();
        console.log(`Serveur gRPC en écoute sur ${address}`);
    });
}

main();