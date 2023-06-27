const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const express = require('express');

const app = express();
const port = 8181;

app.get('/', (req, res) => {
    res.send('hello');
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
});

const wss = new WebSocketServer({ port: 8080 });

const sockets = [];

setInterval(() => {
    const data = {
        timestamp: Date.now(),
        nonce: Date.now().toString(),
        key: crypto.randomUUID(),
    };

    console.log('queue:item');

    sockets.forEach(socket => {
        socket.send(JSON.stringify({
            event: 'queue:item',
            src: 'server',
            data,
        }));
    });
}, 3000);

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
