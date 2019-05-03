import PeerToPeerService from "./services/PeerToPeerService";
import { URL } from 'url';
import { TransactionMessage } from "./lib/types/MessageType";
import Transaction from "../../models/Transaction";
import Peer from './lib/peer';
import { configuration } from "../../Configuration";
import isNodeJs from "../../services/isNodeJs";
import EventHandler from "./lib/EventHandler";
import * as Logger from 'js-logger';

interface Connection {
    // Offers don't have yet a filled in nodeId,
    nodeId?: string,
    peer: Peer,
}

export interface PeerDataMessage {
    data: {
        type: string;
        value: string;
    }
}

class Network extends EventHandler {
    private connections: Connection[] = [];

    /**
     * Handles the HTTP Requests (Mostly for Node)
     *
     * @private
     * @param {*} req
     * @param {*} res
     * @returns
     * @memberof PeerController
     */
    private handleHttpRequest(req: any, res: any) {
        res.setHeader('Access-Control-Allow-Origin', '*');

        if (req.url === '/nodes') {
            res.writeHead(200, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({
                Result: this.connections,
            }));
         } else if (req.url.includes('/requestSdpConnection')) {
            const requestUrl = new URL('http://localhost.com' + req.url);

            const sdp = requestUrl.searchParams.get('sdp');
            const nodeId = requestUrl.searchParams.get('nodeId');

            // TODO: Return a bad request when no sdp param was found..
            if (!sdp || !nodeId) {
                console.error('No sdp or nodeId available');
                return;
            }

            const descriptionInit: RTCSessionDescription = JSON.parse(sdp);

            if (descriptionInit.type !== 'offer') {
                console.error('SDP is not offer');
                return;
            }

            // Create a response signal and send it as response.
            const peer = new Peer(false);

            peer.onSignal = (offerSignal) => {
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                });
                res.end(JSON.stringify({
                    Result: {
                        sdp: offerSignal,
                        nodeId: configuration.nodeId,
                    }
                }));
            }

            peer.onData = (data) => this.onPeerData(data, peer.id);
            peer.onClose = () => this.onPeerClose(peer.id);
            peer.onConnect = () => this.onPeerConnected(peer.id);
            peer.onError = (error) => this.onPeerError(error, peer.id);
            peer.open();
            peer.connect(descriptionInit)

            // Now use the offer that was given and connect to that node.
            this.connections.push({
                peer,
                nodeId,
            });
         } else {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.end('Page not found.');
        }
    }

    private async onSignal(sessionDescription: RTCSessionDescriptionInit, peerId: string) {
        const response =  await PeerToPeerService.initialHttpNodeConnect(sessionDescription);
        const connectionIndex = this.connections.findIndex(connection => connection.peer.id === peerId);
        const connection = this.connections[connectionIndex];

        if (!response) {
            // this.onPeerClose(peerId);
            Logger.error(`No session description found for ${peerId}`);
            return;
        }

        if (!connection) {
            Logger.error('Could not find connection, not adding');
            return;
        }

        // Since this is our first connection we need more nodes.
        // So we ask the node to give us a list of different nodes.
        connection.peer.onConnect = () => {
            console.log('[PeerToPeer]: First connection has been made');
        }

        // Now completely connect to it.
        // And remember the node Id.
        connection.peer.connect(response.sdp);
        this.connections[connectionIndex].nodeId = response.nodeId;
    }

    // Peer handeling events
    private onPeerClose(peerId: string) {
        const disconnectedConnection = this.connections.findIndex(connection => connection.peer.id === peerId);

        Logger.info(`Peer ${peerId} disconnected`);

        // Remove from array
        this.connections.splice(disconnectedConnection, 1);

        this.trigger('peerClosed', {
            peerId,
            data: null,
        });
    }

    connectToMoreNodes() {
        if (this.connections.length > configuration.maximumNodes) {
            return;
        }

        Logger.debug(`Trying to connect to more nodes (Currently: ${this.connections.length})`);
        const peer = this.createPeer(true, (sdp) => {
            this.onSignal(sdp, peer.id);
        });
    }

    createPeer(initiator = false, onSignal = (sdp: RTCSessionDescriptionInit) => {}) {
        const peer = new Peer(initiator);

        peer.onClose = () => this.onPeerClose(peer.id);
        peer.onConnect = () => this.onPeerConnected(peer.id);
        peer.onData = (data) => this.onPeerData(data, peer.id);
        peer.onSignal = (sdp) => onSignal(sdp);
        peer.onError = (error) => this.onPeerError(error, peer.id);

        peer.open();

        return peer;
    }

    /**
     * Handles the peer data
     * TOOD: Make sure we are not parsing huge strings.
     *
     * @private
     * @param {Uint8Array} data
     * @param {string} peerId
     * @memberof PeerToPeer
     */
    private async onPeerData(data: Uint8Array, peerId: string) {
        this.trigger('message', {
            data,
            peerId,
        });
    }

    private onPeerConnected(peerId: string) {
        this.trigger('peerConnected', {
            data: null,
            peerId,
        })

        Logger.info(`New peer is connected (Total: ${this.connections.length})`);
    }

    private onPeerError(error: any, peerId: string) {
        this.trigger('error', {
            data: error,
            peerId,
        });

        Logger.error('Network error: ', error);
    }

    /**
     * Opens the connection with peer to peer.
     * If it's running on node we will create a simple stung server
     * where all webrtc connections are passed through.
     *
     * @memberof PeerToPeer
     */
    open(): Promise<string> {
        return new Promise((resolve, reject) => {
            if (isNodeJs()) {
                // TODO: Use HTTPS here instead of HTTP
                const http = require('http');
                const httpServer = http.createServer(this.handleHttpRequest.bind(this));

                httpServer.listen(configuration.port, '0.0.0.0');

                Logger.info(`HTTP Listening on port ${configuration.port}`);
            }

            setInterval(() => {
                this.connectToMoreNodes();
            }, 2000);

            // Since we are just opening the node we have to create an offer.
            const peer = new Peer(true);

            peer.onSignal = async (description) => {
                try {
                    await this.onSignal(description, peer.id);
                } catch (error) {
                    reject(error);
                }
            }

            peer.onClose = () => this.onPeerClose(peer.id);
            peer.onData = (data) => this.onPeerData(data, peer.id);
            peer.onConnect = () => {
                this.onPeerConnected(peer.id);

                resolve(peer.id);
            }

            peer.onError = (error) => {
                this.onPeerError(error, peer.id);
                reject(error);
            }

            peer.open();

            this.connections.push({
                peer,
            });
        });
    }

    async broadcastTransaction(transaction: Transaction, skipPeerIds: string[] = []) {
        const message: TransactionMessage = {
            type: 'TRANSACTION',
            value: transaction.toRaw(),
        };

        Logger.debug(`Broadcasting transaction ${transaction.id}`);
        await this.broadcast(JSON.stringify(message), skipPeerIds);
    }

    /**
     * Broadcasts data to all open connections
     *
     * @param {string} data
     * @memberof Network
     */
    async broadcast(data: string, skipPeerIds: string[] = []) {
        this.connections.forEach((connect) => {
            // Make sure it's still connected
            if (!connect.peer.isConnected) {
                return;
            }

            if (skipPeerIds.includes(connect.peer.id)) {
                return;
            }

            connect.peer.sendData(data);
        });
    }

    /**
     * Sends data to a single peer
     *
     * @param {string} peerId
     * @param {string} data
     * @memberof PeerToPeer
     */
    sendDataToPeer(peerId: string, data: string) {
        const connection = this.connections.find(connection => connection.peer.id === peerId);

        if (!connection || !connection.peer.isConnected) {
            throw new Error(`Peer ${peerId} is not connected`);
        }

        connection.peer.sendData(data);
    }

    isOnline() {
        return this.connections.length > 0;
    }
}

export default Network;
