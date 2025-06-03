// index.js
// import Player from './classes/Player.js'

const canvas = document.querySelector('canvas')
const c = canvas.getContext('2d')

const socket = io()

const scoreEl = document.querySelector('#scoreEl')

canvas.width = innerWidth
canvas.height = innerHeight

const x = canvas.width / 2
const y = canvas.height / 2

const player = new Player(x, y, 10, 'white')
const players = {} // this is dif from backend players. it will contain Player objects and we can call their methods
let pendingSubmission = null

document.getElementById('startGameBtn').addEventListener('click', () => {
  socket.emit('preround')
})


// <----- SOCKET HANDLERS ----->

let myId = null
socket.on('connect', () => {
  myId = socket.id
})

socket.on('gameStarted', () => {
  document.getElementById('lobbyUI').style.display = 'none'
})

socket.on('selectTheme', ({ judgeId, themeChoices }) => {
  const amIJudge = (socket.id === judgeId)
  document.getElementById('judgeUI').style.display = 'none'

  if (amIJudge) {
    document.getElementById('judgeUI').style.display = 'block'
    document.getElementById('themeOptions').innerHTML = ''

    themeChoices.forEach(theme => {
      const btn = document.createElement('button')
      btn.textContent = theme
      btn.onclick = () => {
        submitTheme(theme)
      }
      themeOptions.appendChild(btn)  // adding the 3 buttons to the themeOptions div
    })

    // Set up custom theme input
    document.getElementById('submitCustomThemeBtn').onclick = () => {
      const customTheme = document.getElementById('customThemeInput').value.trim()
      if (customTheme) {
        submitTheme(customTheme)
      }
    }
  }
})

socket.on('broadcastTheme', (theme) => {
  const me = players[myId]
  if (me && !me.isJudge) {
    document.getElementById('submitUI').style.display = 'block'
    document.getElementById('currentThemeText').textContent = theme
  }
})

socket.on('updatePlayers', (backendPlayers) => {
  document.getElementById('roomCode').textContent = `Room Code: ${window.currentRoomCode}`

  // === UPDATING PLAYERS OBJECT ===
  for (const id in backendPlayers) {
    const backendPlayer = backendPlayers[id]

    if (!players[id]) {
      players[id] = new Player(backendPlayer.name, backendPlayer.isHost, backendPlayer.isJudge)
    } else {
      players[id].name = backendPlayer.name
      players[id].isHost = backendPlayer.isHost
      players[id].isJudge = backendPlayer.isJudge
    } 
  }
  console.log(players)

  // === LOBBY UI ===
  for (let i = 0; i < 6; i++) {
    const slot = document.getElementById(`slot${i}`)
    if (slot) {
      slot.textContent = ''  // clear the ui of any names already there
    }
  }
  const playerIds = Object.keys(backendPlayers)  // returns an array of strings
  playerIds.forEach((id, index) => {
    const slot = document.getElementById(`slot${index}`)
    if (slot) {
      slot.textContent = backendPlayers[id].isHost ? `${backendPlayers[id].name} (Host)` : backendPlayers[id].name  // if it's the host, inlude the host label
    }
  })

  const me = backendPlayers[socket.id]
  document.getElementById('startGameBtn').style.display = me?.isHost ? 'inline-block' : 'none'  // make the Start Game button only visible to the host
})

socket.on('allSubmissionsIn', (submissions) => {
  const me = players[socket.id]
  if (!me || !me.isJudge) return

  // Clear the judge panel and make it visible
  document.getElementById('judgePanel').style.display = 'block'
  const judgeResults = document.getElementById('judgeResults')
  judgeResults.innerHTML = ''

  // Populate the judge panel
  for (const id in submissions) {
    const track = submissions[id]

    const div = document.createElement('div')
    div.className = 'track'
    div.style.display = 'flex'
    div.style.alignItems = 'center'
    div.style.marginBottom = '10px'

    // Cover image
    const img = document.createElement('img')
    img.src = track.cover
    img.alt = 'cover art'
    img.width = 60
    img.style.cursor = 'pointer'
    img.style.marginRight = '10px'
    img.onclick = (e) => {
      e.stopPropagation()
      const player = document.getElementById('judgePlayer')
      player.src = track.preview
      player.style.display = 'block'
      player.play()
    }

    // Text
    const textDiv = document.createElement('div')
    textDiv.innerHTML = `<strong>${track.title}</strong><br><small>${track.artist}</small>`
    textDiv.style.cursor = 'pointer'
    textDiv.onclick = () => {
      socket.emit('winnerSelected', {roomCode: window.currentRoomCode, winnerId: id })
      document.getElementById('judgePanel').style.display = 'none'
    }

    div.appendChild(img)
    div.appendChild(textDiv)
    judgeResults.appendChild(div)
  }
})

socket.on('roundWinner', ({ winnerId, winnerName, trackTitle, trackArtist, players: updatedPlayers, gameOver }) => {
  for (const id in updatedPlayers) {
    const backendPlayer = updatedPlayers[id]

    if (!players[id]) {
      players[id] = new Player(backendPlayer.name, backendPlayer.isHost)
    }
    players[id].score = backendPlayer.score
  }

  showToast(`${winnerName} won the round with "${trackTitle}" by ${trackArtist}`)

  const leaderboard = document.getElementById('leaderboard')
  const list = document.getElementById('leaderboardList')
  list.innerHTML = ''

  const sorted = Object.entries(updatedPlayers).sort((a, b) => b[1].score - a[1].score)
  sorted.forEach(([id, player], index) => {
    const entry = document.createElement('div')
    entry.className = 'leaderboard-entry'

    entry.innerHTML = `
      <div class="rank">${index + 1}</div>
      <img class="avatar" src="./assets/pfp.png" alt="pfp">
      <div class="name">${player.name}</div>
      <div class="score">${player.score.toString().padStart(2, '0')}</div>
    `

    list.appendChild(entry)
  })


  leaderboard.style.display = 'block'
  let timeLeft = 10
  const countdownText = document.getElementById('countdownText')
  countdownText.textContent = `Next round starts in ${timeLeft} seconds`

  const countdownInterval = setInterval(() => {
    timeLeft -= 1
    if (timeLeft > 0) {
      countdownText.textContent = `Next round starts in ${timeLeft} seconds`
    } else {
      clearInterval(countdownInterval)
      leaderboard.style.display = 'none'
      countdownText.textContent = ''

      if (gameOver) {
        showToast(`${winnerName} has won the game!`)  // use your modal here
      }
    }
  }, 1000)

  document.getElementById('judgePanel').style.display = 'none'
  document.getElementById('submitUI').style.display = 'none'
  document.getElementById('confirmModal').style.display = 'none'
})

socket.on('showToast', (message) => {
  showToast(message)
})


// <----- FUNCTIONS ----->

let animationId
function animate() {
  animationId = requestAnimationFrame(animate)
  c.fillStyle = 'rgba(0, 0, 0, 0.1)'
  c.fillRect(0, 0, canvas.width, canvas.height)

  for (const id in players) {
    const player = players[id]
    player.draw()
  }
}

function fetchJsonp(url) {
  return new Promise((resolve, reject) => {
    const callbackName = 'jsonp_cb_' + Math.random().toString(36).substr(2, 10)
    window[callbackName] = data => {
      delete window[callbackName]
      document.body.removeChild(script)
      resolve({ json: () => Promise.resolve(data) })
    }

    const script = document.createElement('script')
    script.src = url + `&callback=${callbackName}`
    script.onerror = reject
    document.body.appendChild(script)
  })
}

async function searchSongs() {
  const query = document.getElementById('searchInput').value.trim()
  if (!query) {
    showError('Please enter a search term.');
    return;
  }

  const resultsDiv = document.getElementById('results')
  resultsDiv.innerHTML = 'Searching...'

  const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&output=jsonp`
  const response = await fetchJsonp(url)
  const data = await response.json()

  resultsDiv.innerHTML = ''
  const tracks = data.data.slice(0, 5)

  tracks.forEach(track => {
    const div = document.createElement('div')
    div.className = 'track'
    div.style.display = 'flex'
    div.style.alignItems = 'center'
    div.style.marginBottom = '10px'
    
    // Displayer cover art, play preview when clicked
    const img = document.createElement('img')
    img.src = track.album.cover_medium
    img.alt = 'cover art'
    img.width = 60
    img.style.cursor = 'pointer'
    img.style.marginRight = '10px'
    img.onclick = (e) => {
      e.stopPropagation()  // Prevent triggering submission when clicking image
      playPreview(track.preview)
    }

    const textDiv = document.createElement('div')
    textDiv.innerHTML = `<strong>${track.title}</strong><br><small>${track.artist.name}</small>`
    textDiv.style.cursor = 'pointer'
    textDiv.onclick = () => confirmSubmit(track)

    div.appendChild(img)
    div.appendChild(textDiv)
    resultsDiv.appendChild(div)
  })
}

function playPreview(url) {
  const player = document.getElementById('player')
  player.src = url
  player.style.display = 'block'
  player.play()
}

function confirmSubmit(track) {
  pendingSubmission = track

  const confirmText = document.getElementById('confirmText')
  confirmText.innerHTML = `Submit <strong>${track.title}</strong> by <strong>${track.artist.name}</strong>?`

  document.getElementById('confirmModal').style.display = 'flex'
}

document.getElementById('confirmYes').onclick = () => {
  if (pendingSubmission) {
    actuallySubmitSong(pendingSubmission)
    pendingSubmission = null
    document.getElementById('confirmModal').style.display = 'none'
  }
}

document.getElementById('confirmNo').onclick = () => {
  pendingSubmission = null
  document.getElementById('confirmModal').style.display = 'none'
}

function actuallySubmitSong(track) {
  const submission = {
    title: track.title,
    artist: track.artist.name,
    preview: track.preview,
    cover: track.album.cover_medium
  }

  // Stop the audio if it is currently playing
  const player = document.getElementById('player')
  if (!player.paused) {
    player.pause()
    player.currentTime = 0
  }

  socket.emit('songSubmitted', { roomCode: window.currentRoomCode, track: submission })
  document.getElementById('submitUI').style.display = 'none'
}

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let code = ''
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

// function submitName() {
//   const playerName = document.getElementById("playerNameInput").value.trim()
//   if (playerName) {
//     socket.emit('playerJoined', playerName)
//     document.getElementById('nameForm').style.display = 'none'
//   }
// }
// window.submitName = submitName

function createRoom() {
  const name = document.getElementById("playerNameInput").value.trim()
  
  if (!name) {
    showError('Please enter your name before creating a room.')
    return
  }  

  const db = window.firebaseDB
  const ref = window.firebaseRef
  const set = window.firebaseSet
  const roomCode = generateRoomCode()

  set(ref(db, 'rooms/' + roomCode), {
    hostId: socket.id,
    createdAt: Date.now(),
    players: {
      [socket.id]: {
        name,
        isHost: true,
        isJudge: false,
        score: 0
      }
    }
  })

  window.currentRoomCode = roomCode
  document.getElementById("playerNameInput").textContent = roomCode
  socket.emit('playerJoined', { name, roomCode })
  document.getElementById('nameForm').style.display = 'none'
}

async function joinRoom() {
  const name = document.getElementById("playerNameInput").value.trim()
  const roomCode = document.getElementById("roomCodeInput").value.toUpperCase().trim()
  
  if (!name || !roomCode) {
    showError('Please enter your name and a room code.')
    return
  }

  // Check if room exists
  const db = window.firebaseDB
  const ref = window.firebaseRef
  const onValue = window.firebaseOnValue
  const roomExists = await new Promise(resolve => {
    onValue(ref(db, `rooms/${roomCode}`), snapshot => {
      resolve(snapshot.exists())
    }, { onlyOnce: true })
  })
  if (!roomExists) {
    showError('Room not found. Please check the code.')
    return
  }

  window.currentRoomCode = roomCode
  document.getElementById("playerNameInput").textContent = roomCode
  socket.emit('playerJoined', { name, roomCode })
  document.getElementById('nameForm').style.display = 'none'
}

function submitTheme(theme) {
  if (!theme) {
    showError('You must choose or enter a theme.')
    return
  }
  socket.emit('themeSelected', { roomCode: window.currentRoomCode, theme })
  document.getElementById('judgeUI').style.display = 'none'
  console.log(`Theme selected: ${theme}`)
}

function showError(message) {
  document.getElementById('errorText').textContent = message
  document.getElementById('errorModal').classList.remove('hidden')
}

function hideErrorModal() {
  document.getElementById('errorModal').classList.add('hidden')
}

function showToast(message, duration = 3000) {
  const toast = document.getElementById('toastContainer')
  const msg = document.getElementById('toastMessage')
  msg.textContent = message
  toast.classList.remove('hidden')
  toast.classList.add('show')

  setTimeout(() => {
    toast.classList.remove('show')
    setTimeout(() => {
      toast.classList.add('hidden')
      msg.textContent = ''
    }, 300)
  }, duration)
}

animate()