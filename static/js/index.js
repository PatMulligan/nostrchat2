// Create Vue component for the extension
window.app = Vue.createApp({
  el: '#vue',
  mixins: [windowMixin],

  // Declare models/variables
  data() {
    return {
      nostracct: null,
      showKeys: false,
      importKeyDialog: {
        show: false,
        data: {
          privateKey: ''
        }
      },
      wsConnection: null,
      peers: [],
      activePublicKey: null,
      showAddPeer: false,
      newPeerKey: null,
      isMobileView: false
    }
  },

  computed: {
    showPeersList() {
      return !this.$q.screen.lt.md || !this.activePublicKey
    },

    showChatBox() {
      return !this.$q.screen.lt.md || this.activePublicKey
    },

    activePeerName() {
      const peer = this.peers.find(p => p?.public_key === this.activePublicKey)
      return peer?.profile?.name || 'Unknown Peer'
    }
  },

  // Where functions live
  methods: {
    generateKeys: async function () {
      const privateKey = window.NostrTools.generatePrivateKey()
      await this.createNostrAcct(privateKey)
    },

    importKeys: async function () {
      this.importKeyDialog.show = false
      let privateKey = this.importKeyDialog.data.privateKey
      if (!privateKey) return

      try {
        if (privateKey.toLowerCase().startsWith('nsec')) {
          privateKey = window.NostrTools.nip19.decode(privateKey).data
        }
      } catch (error) {
        LNbits.utils.notifyApiError(error)
      }
      await this.createNostrAcct(privateKey)
    },

    showImportKeysDialog() {
      this.importKeyDialog.show = true
    },

    toggleShowKeys() {
      this.showKeys = !this.showKeys
    },

    toggleNostrAcctState: async function () {
      const nostracct = await this.getNostrAcct()
      if (!nostracct) {
        this.$q.notify({
          timeout: 5000,
          type: 'warning',
          message: 'Cannot fetch nostracct!'
        })
        return
      }
      const message = nostracct.config.active
        ? 'New orders will not be processed. Are you sure you want to deactivate?'
        : nostracct.config.restore_in_progress
          ? 'NostrAcct restore  from nostr in progress. Please wait!! ' +
          'Activating now can lead to duplicate order processing. Click "OK" if you want to activate anyway?'
          : 'Are you sure you want activate this nostracct?'

      LNbits.utils.confirmDialog(message).onOk(async () => {
        await this.toggleNostrAcct()
      })
    },

    toggleNostrAcct: async function () {
      try {
        const { data } = await LNbits.api.request(
          'PUT',
          `/nostrchat/api/v1/nostracct/${this.nostracct.id}/toggle`,
          this.g.user.wallets[0].adminkey
        )
        const state = data.config.active ? 'activated' : 'disabled'
        this.nostracct = data
        this.$q.notify({
          type: 'positive',
          message: `'NostrAcct ${state}`,
          timeout: 5000
        })
      } catch (error) {
        console.warn(error)
        LNbits.utils.notifyApiError(error)
      }
    },

    handleNostrAcctDeleted: function () {
      this.nostracct = null
      this.showKeys = false
    },

    async getNostrAcct() {
      try {
        const { data } = await LNbits.api.request(
          'GET',
          '/nostrchat/api/v1/nostracct',
          this.g.user.wallets[0].inkey
        )
        this.nostracct = data
      } catch (error) {
        LNbits.utils.notifyApiError(error)
      }
    },

    async createNostrAcct(privateKey) {
      try {
        const pubkey = window.NostrTools.getPublicKey(privateKey)
        const payload = {
          private_key: privateKey,
          public_key: pubkey,
          config: {}
        }
        const { data } = await LNbits.api.request(
          'POST',
          '/nostrchat/api/v1/nostracct',
          this.g.user.wallets[0].adminkey,
          payload
        )
        this.nostracct = data
        this.$q.notify({
          type: 'positive',
          message: 'Nostr Account Created!',
          icon: 'check',
          timeout: 5000
        })
        this.waitForNotifications()
      } catch (error) {
        LNbits.utils.notifyApiError(error)
      }
    },

    async waitForNotifications() {
      if (!this.nostracct) return

      try {
        const scheme = location.protocol === 'http:' ? 'ws' : 'wss'
        const port = location.port ? `:${location.port}` : ''
        const wsUrl = `${scheme}://${document.domain}${port}/api/v1/ws/${this.nostracct.id}`

        this.wsConnection = new WebSocket(wsUrl)
        this.wsConnection.addEventListener('message', async ({ data }) => {
          const parsedData = JSON.parse(data)
          if (parsedData.type === 'dm:-1') {
            await this.$refs.directMessagesRef.handleNewMessage(parsedData)
          }
        })
      } catch (error) {
        LNbits.utils.notifyError('Failed to watch for updates')
      }
    },

    async restartNostrConnection() {
      try {
        await LNbits.utils.confirmDialog(
          'Are you sure you want to reconnect to the nostrcient extension?'
        )
        await LNbits.api.request(
          'PUT',
          '/nostrchat/api/v1/restart',
          this.g.user.wallets[0].adminkey
        )
      } catch (error) {
        LNbits.utils.notifyApiError(error)
      }
    },

    async getPeers() {
      try {
        const { data } = await LNbits.api.request(
          'GET',
          '/nostrchat/api/v1/peer',
          this.g.user.wallets[0].inkey
        )
        this.peers = data
      } catch (error) {
        LNbits.utils.notifyApiError(error)
      }
    },

    async addPeer() {
      try {
        const { data } = await LNbits.api.request(
          'POST',
          '/nostrchat/api/v1/peer',
          this.g.user.wallets[0].adminkey,
          {
            public_key: this.newPeerKey,
            nostracct_id: this.nostracct.id,
            unread_messages: 0
          }
        )
        this.newPeerKey = null
        this.activePublicKey = data.public_key
        await this.getPeers()
      } catch (error) {
        LNbits.utils.notifyApiError(error)
      } finally {
        this.showAddPeer = false
      }
    },

    handlePeerSelected(publicKey) {
      this.activePublicKey = publicKey
    },

    handleBackToList() {
      this.activePublicKey = null
    },

    refreshPeers() {
      this.getPeers()
    }
  },

  // To run on startup
  created() {
    this.getNostrAcct()
    setInterval(() => {
      if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
        this.waitForNotifications()
      }
    }, 1000)
  },

  watch: {
    'nostracct.id': {
      immediate: true,
      handler(newVal) {
        if (newVal) {
          this.getPeers()
        }
      }
    }
  }
})

// Mount after components are registered
setTimeout(() => {
  window.app.mount()
}, 0)
