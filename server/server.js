const { WebSocketServer } = require('ws');

const wss = new WebSocketServer({ port: 8080 });

const sockets = [];

wss.on('connection', function connection(ws) {
    sockets.push(ws);

    ws.on('close', () => {
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
