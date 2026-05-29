// WebRTC voice — mesh P2P, signaling via Socket.io
const webrtc = {
  peers: new Map(),    // socketId -> RTCPeerConnection
  localStream: null,
  active: false,
  audioEls: new Map(), // socketId -> HTMLAudioElement

  async join() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.active = true;
      state.socket.emit('voice-join');
      return true;
    } catch (err) {
      console.error('Microphone access denied:', err);
      return false;
    }
  },

  leave() {
    this.active = false;
    for (const [id, pc] of this.peers) {
      pc.close();
      this._removeAudio(id);
    }
    this.peers.clear();
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    state.socket.emit('voice-leave');
  },

  async handleNewPeer(socketId) {
    if (!this.active || this.peers.has(socketId)) return;
    const pc = this._createPC(socketId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    state.socket.emit('webrtc-offer', { to: socketId, offer });
  },

  async handleOffer(from, offer) {
    if (!this.active) return;
    if (this.peers.has(from)) this.peers.get(from).close();
    const pc = this._createPC(from);
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    state.socket.emit('webrtc-answer', { to: from, answer });
  },

  async handleAnswer(from, answer) {
    const pc = this.peers.get(from);
    if (pc) await pc.setRemoteDescription(answer);
  },

  handleIceCandidate(from, candidate) {
    const pc = this.peers.get(from);
    if (pc) pc.addIceCandidate(candidate);
  },

  handlePeerLeft(socketId) {
    const pc = this.peers.get(socketId);
    if (pc) pc.close();
    this.peers.delete(socketId);
    this._removeAudio(socketId);
  },

  _createPC(socketId) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    if (this.localStream) {
      this.localStream.getTracks().forEach(t => pc.addTrack(t, this.localStream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        state.socket.emit('webrtc-ice-candidate', { to: socketId, candidate: e.candidate });
      }
    };

    pc.ontrack = (e) => {
      this._addAudio(socketId, e.streams[0]);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        pc.close();
        this.peers.delete(socketId);
        this._removeAudio(socketId);
        this._reconnect(socketId);
      }
    };

    this.peers.set(socketId, pc);
    return pc;
  },

  _addAudio(socketId, stream) {
    this._removeAudio(socketId);
    const audio = new Audio();
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.id = 'remote-audio-' + socketId;
    document.body.appendChild(audio);
    this.audioEls.set(socketId, audio);
  },

  _removeAudio(socketId) {
    const audio = this.audioEls.get(socketId);
    if (audio) { audio.remove(); this.audioEls.delete(socketId); }
  },

  async _reconnect(socketId) {
    // Simple reconnection: if peer dropped, re-initiate
    if (!this.active) return;
    await this.handleNewPeer(socketId);
  },
};
