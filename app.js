// app.js
// file reader setup
const fs = require('fs')
const themes = fs.readFileSync('./themes.txt', 'utf-8').split('\n').map(t => t.trim()).filter(t => t)

// socket.io setup
const express = require('express')
const app = express()
const http = require('http')
const server = http.createServer(app)
const { Server } = require('socket.io')
const io = new Server(server)

const port = 3000

app.use(express.static('public'))

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html')
})

// const submissions = {}
// let judgeQueues = {}
// let judgeIndexes = {}

const admin = require('firebase-admin')
const serviceAccount = require('./TrackMatch Firebase Service Account.json') // you’ll download this below
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://trackmatch-3b0b8-default-rtdb.firebaseio.com/"
})
const db = admin.database()
const ref = db.ref.bind(db)

io.on('connection', (socket) => {  // each time a user connects, the socket argument will contain information about that connection
    socket.on('playerJoined', async ({ name, roomCode }) => {
        if (!name || !roomCode) {
            console.warn("Missing name or roomCode in playerJoined payload")
            return
        }
        socket.join(roomCode)
        socket.data.roomCode = roomCode
        
        const snapshot = await ref(`rooms/${roomCode}/players`).get()
        const playersSnap = snapshot.exists() ? snapshot.val() : {}
        const numOfPlayers = Object.keys(playersSnap).length

        if (numOfPlayers >= 6) {
            console.log("Room is full.")
            return
        }
        
        if (!playersSnap[socket.id]) {
            await ref(`rooms/${roomCode}/players/${socket.id}`).set({
              name,
              isHost: numOfPlayers === 0,
              isJudge: false,
              score: 0
            })
        }

        const updatedSnapshot = await ref(`rooms/${roomCode}/players`).get()
        const updatedPlayers = updatedSnapshot.exists() ? updatedSnapshot.val() : {}

        io.to(roomCode).emit('updatePlayers', updatedPlayers)
        console.log(updatedPlayers)
    })

    socket.on('preround', () => {
        const roomCode = socket.data.roomCode
        if (roomCode) startRound(roomCode)
    })

    socket.on('themeSelected', ({ roomCode, theme }) => {
        console.log(`Theme selected: ${theme}`)
        io.to(roomCode).emit('broadcastTheme', theme)
    })

    socket.on('songSubmitted', async ({ roomCode, track }) => {
        if (!roomCode || !track) {
            console.log("songSubmitted: Missing roomCode or track")
        }

        await ref(`rooms/${roomCode}/submissions/${socket.id}`).set(track)

        const snapshot = await ref(`rooms/${roomCode}/players`).get()
        const playersSnap = snapshot.exists() ? snapshot.val() : {}
        const nonJudges = Object.keys(playersSnap).filter(id => !playersSnap[id].isJudge)
        const submissionsSnap = await ref(`rooms/${roomCode}/submissions`).get()
        const submissions = submissionsSnap.exists() ? submissionsSnap.val() : {}
        const allSubmitted = nonJudges.every(id => submissions[id])
        console.log(`${playersSnap[socket.id].name} submitted:`, track)

        if (allSubmitted) {
            console.log('All non-judge players have submitted. Sending to judge...')
            io.to(roomCode).emit('allSubmissionsIn', submissions)
        }
    })

    socket.on('winnerSelected', async ({ roomCode, winnerId }) => {
        if (!roomCode || !winnerId) {
            console.log("Invalid winner selection")
            return
        }

        const snapshot = await ref(`rooms/${roomCode}/players`).get()
        const playersSnap = snapshot.exists() ? snapshot.val() : {}
        const winner = playersSnap[winnerId]
        const trackSnap = await ref(`rooms/${roomCode}/submissions/${winnerId}`).get();
        const track = trackSnap.exists() ? trackSnap.val() : null;

        if (!winner || !track) return  // we check this just to protect against double emits

        winner.score += 1
        const gameOver = winner.score >= 5

        await ref(`rooms/${roomCode}/players/${winnerId}/score`).set(winner.score)
        const updatedSnapshot = await ref(`rooms/${roomCode}/players`).get()
        const updatedPlayersSnap = updatedSnapshot.exists() ? updatedSnapshot.val() : {}
      
        io.emit('roundWinner', {
            winnerId,
            winnerName: winner.name,
            trackTitle: track.title,
            trackArtist: track.artist,
            players: updatedPlayersSnap,
            gameOver
        })

        await ref(`rooms/${roomCode}/submissions`).remove();

        if (!gameOver) {
            setTimeout(() => {
                startRound(roomCode)
            }, 10000)
        }
    })

    socket.on('disconnect', async () => {
        const roomCode = socket.data.roomCode;
        if (!roomCode) {
            console.log("Room code error")
            return
        }
      
        const playerRef = ref(`rooms/${roomCode}/players/${socket.id}`);
        const playersRef = ref(`rooms/${roomCode}/players`);
        const roomRef = ref(`rooms/${roomCode}`);
      
        // Get current players before removal
        const preSnapshot = await playersRef.get();
        const players = preSnapshot.exists() ? preSnapshot.val() : {};
        const wasHost = players[socket.id]?.isHost;
        const playerName = players[socket.id]?.name || "A player";
      
        // Remove player
        await playerRef.remove();
      
        // Get updated list
        const snapshot = await playersRef.get();
        const updatedPlayers = snapshot.exists() ? snapshot.val() : {};
        const playerIds = Object.keys(updatedPlayers);
      
        // === 🧹 Delete room if empty ===
        if (playerIds.length === 0) {
          await roomRef.remove();
          console.log(`🗑️ Room ${roomCode} deleted (no players left)`);
          return;
        }
      
        // === 🪪 Reassign host ===
        if (wasHost) {
          const newHostId = playerIds[0];
          updatedPlayers[newHostId].isHost = true;
          await ref(`rooms/${roomCode}/players/${newHostId}/isHost`).set(true);
        }
      
        // === 🛑 End game if 1 player left ===
        if (playerIds.length === 1) {
          io.to(roomCode).emit('gameEnded', { reason: 'Only one player remaining. Game ended.' });
        }
      
        // === 📣 Notify remaining players ===
        io.to(roomCode).emit('showToast', `${playerName} has left the game`);
      
        // === 🔄 Update player list ===
        io.to(roomCode).emit('updatePlayers', updatedPlayers);
    });      
})

server.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})

async function startRound(roomCode) {
    const snapshot = await ref(`rooms/${roomCode}/players`).get()
    const playersSnap = snapshot.exists() ? snapshot.val() : {}
    const playerIds = Object.keys(playersSnap)
    if (playerIds.length === 0) {
        console.log("Cannot start, no players have joined yet")
        return
    }

    const judgeQueueRef = ref(`rooms/${roomCode}/judgeQueue`);
    let judgeQueueSnap = await judgeQueueRef.get();
    let judgeQueue = judgeQueueSnap.exists() ? judgeQueueSnap.val() : null;

    // initialize judge queue
    if (!judgeQueue) {
        judgeQueue = [...playerIds]
        
        // Shuffle the judge queue
        for (let i = judgeQueue.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1))
            ;[judgeQueue[i], judgeQueue[j]] = [judgeQueue[j], judgeQueue[i]]
        }
        await ref(`rooms/${roomCode}/judgeQueue`).set(judgeQueue);
        await ref(`rooms/${roomCode}/judgeIndex`).set(0);

        console.log('Initial judge order for', roomCode)
        judgeQueue.forEach((id, index) => {
            console.log(`${index + 1}. ${playersSnap[id]?.name || id}`)
        })
    }

    const indexSnap = await ref(`rooms/${roomCode}/judgeIndex`).get();
    const currentIndex = indexSnap.exists() ? indexSnap.val() : 0;

    // reset all players to 'not judge' before selecting the judge for this round
    for (const id in playersSnap) {
        playersSnap[id].isJudge = false
    }

    const judgeId = judgeQueue[currentIndex];
    playersSnap[judgeId].isJudge = true;
    const nextIndex = (currentIndex + 1) % judgeQueue.length;
    await ref(`rooms/${roomCode}/judgeIndex`).set(nextIndex);

    await ref(`rooms/${roomCode}/players`).set(playersSnap)
    const updatedSnapshot = await ref(`rooms/${roomCode}/players`).get()
    const updatedPlayersSnap = updatedSnapshot.exists() ? updatedSnapshot.val() : {}
    console.log(updatedPlayersSnap)

    // shuffle themes array
    const shuffled = [...themes]  // copy of themes
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const themeChoices = shuffled.slice(0, 3)

    io.to(roomCode).emit('updatePlayers', updatedPlayersSnap)
    io.to(roomCode).emit('gameStarted')
    io.to(roomCode).emit('selectTheme', { judgeId, themeChoices })
}