const http = require("http")
const express = require('express')
const app = express()
const fs = require("fs");
const ws = require('ws');
let playersById = {}

app.use(express.static('www'))

const server = http.createServer(app);
const wss = new ws.Server({ server });

const config = JSON.parse(fs.readFileSync("config.json", "utf8"));

wss.on('connection', socket => {
  socket.on('message', message => console.log(message));
  sendPlayers();
});

if (config.playersJson && fs.existsSync(config.playersJson)) {
	try {
		playersById = JSON.parse(fs.readFileSync(config.playersJson));
	} catch(e) {
		console.error(e);
	}
}

function sendPlayers() {
	fs.readFile(config.log, "utf8", (err, data) => {
		if (err) {
			console.log(err);
		} else {
			const lines = data.split("\n");

			let playersWithoutName = [];
			for (let line of lines) {
				const handshake = line.match(/(handshake from client )(\d+)/);
				const zdoid = line.match(/(Got character ZDOID from )([a-zA-Z\u00C0-\u00FF ]+)(\s:)/);
				const disconnected = line.match(/(Closing socket )(\d\d+)/)
				if (handshake) {
					const id = handshake[2];
					const time = new Date(line.match(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}/));
					const minutesConnected = Math.round((new Date() - time) / 60000);
					const player = {id, connected: time, disconnected: null, name: null, minutesConnected, totalMinutesConnected: 0, lastDisconnected: null};
					if (playersById[id]) {
						player.totalMinutesConnected = playersById[id].totalMinutesConnected;
						player.lastDisconnected = playersById[id].lastDisconnected;
					}
					playersById[id] = player;
					playersWithoutName.push(player);
				}
				if (disconnected) {
					const id = disconnected[2];
					const player = playersById[id];
					if (player) {
						const time = new Date(line.match(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}/));
						player.disconnected = time;
						player.minutesConnected = Math.round((new Date(player.disconnected) - new Date(player.connected)) / 60000);
						if (!player.lastDisconnected || new Date(player.lastDisconnected) < new Date(player.disconnected)) {
							player.totalMinutesConnected += player.minutesConnected;
							player.lastDisconnected = player.disconnected;
						}
					}
				}
				if (zdoid) {
					const playerName = zdoid[2];
					if (playersWithoutName.length > 0) {
						const player = playersWithoutName[0];
						player.name = playerName;
						for (const pId in playersById) {
							if (playersById[pId].name == playerName && pId !== player.id) {
								if (playersById[pId].totalMinutesConnected) {
									player.totalMinutesConnected += playersById[pId].totalMinutesConnected;
								}
								delete playersById[pId];
							}
						}
						playersWithoutName.splice(0, 1);
					}
				}
			}
			for (const pId in playersById) {
				if (!playersById[pId].name) {
					delete playersById[pId];
				}
			}
			wss.clients.forEach((client) => {
				const data = {
					players: Object.values(playersById),
					serverName: config.serverName
				};
				client.send(JSON.stringify(data));
			});
			if (config.playersJson) {
				try {
					fs.writeFileSync(config.playersJson, JSON.stringify(playersById));
				} catch(e) {
					console.error(e);
				}
			}
		}
		setTimeout(sendPlayers, config.freq);
	});
}

setTimeout(sendPlayers, config.freq);

server.listen(config.port, () => {
  console.log(`Valheim status at http://localhost:${config.port}`)
})
