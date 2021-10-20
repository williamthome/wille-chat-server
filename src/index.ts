import { Server, Socket } from 'socket.io'

const PORT: string = process.env.PORT || '5000'
const ORIGIN: string = process.env.ORIGIN || 'http://localhost:8080'

const io = new Server(Number.parseInt(PORT), {
  cors: {
    origin: ORIGIN,
    methods: ['GET', 'POST'],
    credentials: true,
  },
})

type User = { clientId: Socket['id']; username: string; typing?: boolean }
type Client = {
  socket: Socket
  username?: string
  activeRoomName?: string
}
type Message = { from: string; text: string; when: number }
type Room = { users: User[]; messages: Message[] }
type Rooms = { [name: string]: Room }
type ChatError = { message: string }

const users: Set<string> = new Set()
const rooms: Rooms = {}

const bannedNames = ['bot', 'cu', 'pau', 'foder', 'ass', 'fuckyou', 'fuck']

io.on('connection', (client: Socket) => {
  const { id } = client

  const connectedClient: Client = {
    socket: client,
  }

  console.log(`connected ${id}`, { rooms })

  client.on('disconnect', () => {
    logout({
      client: connectedClient,
    })

    console.log(`disconnected ${id}`)
  })

  client.on('login', (data: { username: string }) => {
    const { username } = data

    let error: ChatError | undefined

    if (bannedNames.some((banned) => banned.toLowerCase().includes(username.toLowerCase()))) {
      error = {
        message: 'Invalid username. Try another',
      }
    } else if (users.has(username)) {
      error = {
        message: 'Username already taken. Try another',
      }
    }

    if (error) {
      client.emit('error', error)
      console.error(error)
      return
    }

    users.add(username)
    connectedClient.username = username
    client.emit('login', { rooms, username })

    console.log(`logged in ${id}`, { username })
  })

  client.on('logout', () => {
    logout({
      client: connectedClient,
    })
  })

  client.on('joinOrCreateRoom', (data: { roomName: string }) => {
    const { username } = connectedClient
    if (!username) return

    const { roomName } = data
    if (rooms[roomName] !== undefined) {
      rooms[roomName].users.push({
        clientId: id,
        username,
      })
      console.log(`joined room`, { username, roomName, room: rooms[roomName] })
    } else {
      if (bannedNames.some((banned) => banned.toLowerCase().includes(roomName.toLowerCase()))) {
        const error: ChatError = {
          message: 'Invalid room name. Try another',
        }
        client.emit('error', error)
        console.error(error)
        return
      }

      rooms[roomName] = {
        users: [
          {
            clientId: id,
            username,
          },
        ],
        messages: [],
      }
      console.log(`room created`, { username, roomName, room: rooms[roomName] })
      client.broadcast.emit('roomCreated', { roomName, rooms })
    }
    connectedClient.activeRoomName = roomName
    client.join(roomName)
    client.emit('joinedRoom', { roomName, room: rooms[roomName] })
    client.to(connectedClient.activeRoomName).broadcast.emit('userJoinRoom', {
      username,
      users: rooms[connectedClient.activeRoomName].users,
    })
  })

  client.on('leaveRoom', () => {
    if (!connectedClient.activeRoomName) return

    leaveRoom({
      client: connectedClient,
    })
  })

  client.on('message', (data: { message: string }) => {
    const { message: text } = data
    const { activeRoomName, username } = connectedClient
    if (!activeRoomName || !username) return

    const message: Message = {
      from: username,
      text,
      when: Date.now(),
    }
    rooms[activeRoomName].messages.push(message)

    io.to(activeRoomName).emit('message', {
      message,
      messages: rooms[activeRoomName].messages,
    })

    console.log('message sent', data)
  })

  client.on('typing', (data: { typing: boolean }) => {
    const { activeRoomName, username } = connectedClient
    if (!activeRoomName || !username) return

    const { typing } = data

    client.to(activeRoomName).broadcast.emit('typing', {
      username,
      typing,
    })

    console.log('user is typing', { username, typing })
  })
})

const leaveRoom = (data: { client: Client }): void => {
  const { client } = data
  const { username, socket, activeRoomName: activeRoomName } = client

  if (!activeRoomName) return

  rooms[activeRoomName].users = rooms[activeRoomName].users.filter(
    (user) => user.clientId !== client.socket.id
  )

  if (rooms[activeRoomName].users.length === 0) {
    delete rooms[activeRoomName]
    io.sockets.emit('roomDeleted', { activeRoomName, rooms })
    console.log('room users list is empty then room is deleted')
  }

  socket.leave(activeRoomName)
  socket.emit('leaveRoom', { rooms })
  socket.to(activeRoomName).broadcast.emit('userLeftRoom', {
    username,
    users: rooms[activeRoomName]?.users,
  })
  client.activeRoomName = undefined

  console.log(`leaved from room`, {
    username,
    room: rooms[activeRoomName],
  })
}

const logout = (data: { client: Client }) => {
  const { client } = data
  if (!client.username) return

  const { activeRoomName, socket } = client

  if (activeRoomName) {
    leaveRoom({
      client,
    })
  }

  socket.emit('logout')
  users.delete(client.username)
  client.username = undefined

  console.log(`logged out ${client.socket.id}`)
}
