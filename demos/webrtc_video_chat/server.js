const express = require('express');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ 服务器运行在: http://localhost:${PORT}`);
    console.log(`📱 手机请访问: http://<你的IP>:${PORT}`);
});

const wss = new WebSocket.Server({ server });

// 房间存储: roomId -> { offerSdp, answerSdp, offerClient, answerClient }
const rooms = new Map();

wss.on('connection', (ws) => {
    console.log('🔗 新客户端连接');
    let currentRoom = null;
    let isOfferer = false;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log(`📨 [${data.type}]`, data.roomId || '');

            switch (data.type) {

                case 'create': {
                    // PC端创建房间
                    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
                    rooms.set(roomId, {
                        offerSdp: null,
                        answerSdp: null,
                        offerClient: ws,
                        answerClient: null
                    });
                    currentRoom = roomId;
                    isOfferer = true;
                    ws.send(JSON.stringify({ type: 'created', roomId }));
                    console.log(`🏠 创建房间: ${roomId}`);
                    break;
                }

                case 'join': {
                    // 手机端加入房间
                    const roomId = data.roomId.toUpperCase();
                    const room = rooms.get(roomId);
                    if (!room) {
                        ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
                        return;
                    }
                    if (room.answerClient) {
                        ws.send(JSON.stringify({ type: 'error', message: '房间已满' }));
                        return;
                    }
                    currentRoom = roomId;
                    room.answerClient = ws;

                    // 如果有 Offer，立即发给手机端
                    if (room.offerSdp) {
                        ws.send(JSON.stringify({ type: 'offer', sdp: room.offerSdp }));
                    }

                    ws.send(JSON.stringify({ type: 'joined', roomId }));
                    console.log(`🚪 加入房间: ${roomId}`);
                    break;
                }

                case 'offer': {
                    // PC端发送Offer → 存储并转发给手机
                    const room = rooms.get(currentRoom);
                    if (!room) return;
                    room.offerSdp = data.sdp;
                    if (room.answerClient) {
                        room.answerClient.send(JSON.stringify({
                            type: 'offer',
                            sdp: data.sdp
                        }));
                        console.log(`📤 Offer 已转发给手机`);
                    }
                    break;
                }

                case 'answer': {
                    // 手机端发送Answer → 存储并转发给PC
                    const room = rooms.get(currentRoom);
                    if (!room) return;
                    room.answerSdp = data.sdp;
                    if (room.offerClient) {
                        room.offerClient.send(JSON.stringify({
                            type: 'answer',
                            sdp: data.sdp
                        }));
                        console.log(`📤 Answer 已转发给PC`);
                    }
                    break;
                }

                case 'candidate': {
                    // ICE候选转发给对方
                    const room = rooms.get(currentRoom);
                    if (!room) return;
                    const target = isOfferer ? room.answerClient : room.offerClient;
                    if (target && target.readyState === WebSocket.OPEN) {
                        target.send(JSON.stringify({
                            type: 'candidate',
                            candidate: data.candidate
                        }));
                        console.log(`🧊 ICE 候选已转发`);
                    }
                    break;
                }

                case 'leave': {
                    cleanup();
                    break;
                }
            }
        } catch (err) {
            console.error('❌ 消息解析错误:', err);
        }
    });

    ws.on('close', () => {
        console.log('🔌 客户端断开');
        cleanup();
    });

    function cleanup() {
        if (currentRoom && rooms.has(currentRoom)) {
            const room = rooms.get(currentRoom);
            if (isOfferer) {
                room.offerClient = null;
            } else {
                room.answerClient = null;
            }
            // 如果双方都断开了，删除房间
            if (!room.offerClient && !room.answerClient) {
                rooms.delete(currentRoom);
                console.log(`🗑️ 房间已清理: ${currentRoom}`);
            }
        }
        currentRoom = null;
        isOfferer = false;
    }
});

console.log('🚀 WebRTC 信令服务器已启动');