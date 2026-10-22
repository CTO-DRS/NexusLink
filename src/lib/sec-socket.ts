"use client"
// NexusLink — المرحلة 10: عميل قناة الأمان (XTransformPort=3009)
import { io, type Socket } from "socket.io-client"

let socket: Socket | null = null

export function getSecSocket(): Socket {
  if (!socket) {
    socket = io("/?XTransformPort=3009", {
      transports: ["websocket", "polling"],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 40,
      reconnectionDelay: 1000,
      timeout: 10000,
    } as any)
    ;(window as unknown as { __nexusSecSocket?: Socket }).__nexusSecSocket = socket
  }
  return socket
}
