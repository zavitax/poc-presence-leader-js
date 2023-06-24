const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const wss = new WebSocketServer({ port: 8080 });

const sockets = [];

wss.on('connection', function connection(ws) {
    sockets.push(ws);

    const timer = setInterval(() => {
        sockets.forEach(socket => {
            socket.send(JSON.stringify({
                event: 'queue:item',
                src: 'server',
                data: {
                    timestamp: Date.now(),
                    nonce: Date.now().toString(),
                    key: crypto.randomUUID(),
                },
            }));
        });
    }, 9000);

    ws.on('close', () => {
        clearInterval(timer);

        const index = sockets.indexOf(ws);

        sockets.splice(index, 1);
    });

    ws.on('error', console.error);
  
    ws.on('message', function message(data) {
        const msg = data.toString();
        console.log('message: ', msg);
        for (const socket of sockets) {
            socket.send(msg);
        }
    });
});
