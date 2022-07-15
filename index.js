const http = require("http")
const express = require('express')
const app = express()
const fs = require("fs");
const ws = require('ws');
const Ssh2Client = require('ssh2').Client;

let playersById = {}
let lastReadLineTime = null;

app.use(express.static('www'))

const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
const server = http.createServer(app);
const wss = new ws.Server({ server });

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

function readLogAgain() {
	setTimeout(readLog, config.readLogFreq);
}

function readLog() {
	const conn = new Ssh2Client();
	conn.on('ready', function() {
		conn.sftp((err, sftp) => {
			 if (err) {
				console.error(err);
				readLogAgain();
				return;
			 }
			 sftp.readFile(config.log, (err, buffer) => {
				if (err) {
					console.error(err);
					readLogAgain();
					return;
				}
				const data = buffer.toString();
				const lines = data.split("\n");
				
				let connectingPlayers = [];
				for (let line of lines) {
					const dateHourStr = line.match(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}/);
					const logTime = dateHourStr ? new Date(dateHourStr) : null;
					let time = logTime;
					if (time) {
						if (config.gmtHourDifference) {
							time = new Date(time.setHours(time.getHours() + config.gmtHourDifference));
						}
						if (!lastReadLineTime || lastReadLineTime < time) {
							lastReadLineTime = time;
						}
					}

					const handshake = line.match(/(handshake from client )(\d+)/);
					const zdoid = line.match(/(Got character ZDOID from )([a-zA-Z\u00C0-\u00FF ]+)(\s:\s)([\-|0-9]*:[\-|0-9]*)/);
					const disconnected = line.match(/(Closing socket )(\d\d+)/)
					if (handshake) {
						const id = handshake[2];
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
				if (config.playersJson) {
					try {
						fs.writeFileSync(config.playersJson, JSON.stringify(playersById));
					} catch(e) {
						console.error(e);
					}
				}
				readLogAgain();
			 });
		});
	}).connect(config.aleforgeSftpConnectConfig);
}
setTimeout(readLog);

function sendPlayers() {
	const dataStr = JSON.stringify({
		players: Object.values(playersById),
		serverName: config.serverName,
		lastReadLineTime
	});

	wss.clients.forEach((client) => {
		client.send(dataStr);
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

wss.on('connection', sendPlayers);

setInterval(sendPlayers, config.freq);

server.listen(config.port, () => {
	console.log(`Valheim status at http://localhost:${config.port}`);
});
