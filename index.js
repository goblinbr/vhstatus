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
		fs.copyFileSync(config.playersJson, config.playersJson + '.' + new Date().toISOString().replace(/\:/g, '-'));
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

			let connectingPlayers = [];
			for (let line of lines) {
				const handshake = line.match(/(handshake from client )(\d+)/);
				const zdoid = line.match(/(Got character ZDOID from )([a-zA-Z\u00C0-\u00FF ]+)(\s:\s)([\-|0-9]*:[\-|0-9]*)/);
				const disconnected = line.match(/(Closing socket )(\d\d+)/)
				if (handshake) {
					const id = handshake[2];
					const time = new Date(line.match(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}/));
					const oldPlayer = playersById[id];
					if (!oldPlayer || oldPlayer.lastDisconnected && new Date(oldPlayer.lastDisconnected) < time) {
						const minutesConnected = Math.round((new Date() - time) / 60000);
						const newPlayer = {id, connected: time, disconnected: null, name: null, minutesConnected, totalMinutesConnected: 0, lastDisconnected: null, deaths: 0, lastDeath: null};
						if (oldPlayer) {
							newPlayer.name = oldPlayer.name;
							copyStats(newPlayer, oldPlayer);
						}
						connectingPlayers.push(newPlayer);
					}
				}
				if (disconnected) {
					const id = disconnected[2];
					const connectingPlayer = connectingPlayers.filter(e => e.id == id)[0];
					if (connectingPlayer) {
						connectingPlayers.splice(connectingPlayers.indexOf(connectingPlayer), 1);
					} else {
						const player = playersById[id];
						if (player) {
							const time = new Date(line.match(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}/));
							if (!player.lastDisconnected || new Date(player.lastDisconnected) < time) {
								player.disconnected = time;
								player.minutesConnected = Math.round((new Date(player.disconnected) - new Date(player.connected)) / 60000);
								player.totalMinutesConnected += player.minutesConnected;
								player.lastDisconnected = player.disconnected;
							}
						}
					}
				}
				if (zdoid) {
					const playerName = zdoid[2];
					const location = zdoid[4];
					if (location == '0:0') {
						const player = Object.values(playersById).filter(e => e.name == playerName)[0];
						if (player) {
							const time = new Date(line.match(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}/));
							if (!player.lastDeath || new Date(player.lastDeath) < time) {
								if (!player.deaths) {
									player.deaths = 0;
								}
								player.deaths++;
								player.lastDeath = time;
							}
						}
					} else if (connectingPlayers.length > 0) {
						const player = connectingPlayers[0];
						player.name = playerName;
						playersById[player.id] = player;
						for (const pId in playersById) {
							if (playersById[pId].name == playerName && pId !== player.id) {
								if (playersById[pId].totalMinutesConnected) {
									copyStats(player, playersById[pId]);
								}
								delete playersById[pId];
							}
						}
						connectingPlayers.splice(0, 1);
					}
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

function copyStats(dest, orig) {
	if (orig.totalMinutesConnected) {
		dest.totalMinutesConnected = orig.totalMinutesConnected;
		dest.lastDisconnected = orig.lastDisconnected;
	}
	if (orig.deaths) {
		dest.deaths = orig.deaths;
		dest.lastDeath = orig.deaths;
	}
}

setTimeout(sendPlayers, config.freq);

server.listen(config.port, () => {
  console.log(`Valheim status at http://localhost:${config.port}`)
})
