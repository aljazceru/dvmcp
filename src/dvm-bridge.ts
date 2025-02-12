import { NostrAnnouncer } from './nostr/announcer';
import { RelayHandler } from './nostr/relay';
import { keyManager } from './nostr/keys';
import relayHandler from './nostr/relay';
import type { Event } from 'nostr-tools/pure';
import { CONFIG } from './config';
import { MCPPool } from './mcp-pool';

export class DVMBridge {
  private mcpPool: MCPPool;
  private nostrAnnouncer: NostrAnnouncer;
  private relayHandler: RelayHandler;
  private isRunning: boolean = false;

  constructor() {
    console.log('Initializing DVM Bridge...');
    this.mcpPool = new MCPPool(CONFIG.mcp.servers);
    this.relayHandler = relayHandler;
    this.nostrAnnouncer = new NostrAnnouncer(this.mcpPool);
  }

  private isWhitelisted(pubkey: string): boolean {
    if (!CONFIG.whitelist.allowedPubkeys) {
      return true;
    }
    return CONFIG.whitelist.allowedPubkeys.has(pubkey);
  }

  async start() {
    if (this.isRunning) {
      console.log('Bridge is already running');
      return;
    }

    try {
      console.log('Connecting to MCP servers...');
      await this.mcpPool.connect();

      const tools = await this.mcpPool.listTools();
      console.log(`Available MCP tools across all servers: ${tools.length}`);

      console.log('Announcing service to Nostr network...');
      await this.nostrAnnouncer.updateAnnouncement();

      console.log('Setting up request handlers...');
      this.relayHandler.subscribeToRequests(this.handleRequest.bind(this));

      this.isRunning = true;
      console.log('DVM Bridge is now running and ready to handle requests');
    } catch (error) {
      console.error('Failed to start DVM Bridge:', error);
      throw error;
    }
  }

  async stop() {
    if (!this.isRunning) {
      return;
    }

    console.log('Stopping DVM Bridge...');
    try {
      await this.mcpPool.disconnect();
      this.relayHandler.cleanup();
      this.isRunning = false;
      console.log('DVM Bridge stopped successfully');
    } catch (error) {
      console.error('Error stopping DVM Bridge:', error);
      throw error;
    }
  }

  private async handleRequest(event: Event) {
    try {
      if (this.isWhitelisted(event.pubkey)) {
        if (event.kind === 5910) {
          const command = event.tags.find((tag) => tag[0] === 'c')?.[1];

          if (command === 'list-tools') {
            const tools = await this.mcpPool.listTools();
            const response = keyManager.signEvent({
              ...keyManager.createEventTemplate(6910),
              content: JSON.stringify({
                tools,
              }),
              tags: [
                ['request', JSON.stringify(event)],
                ['e', event.id],
                ['p', event.pubkey],
              ],
            });

            await this.relayHandler.publishEvent(response);
          } else {
            const jobRequest = JSON.parse(event.content);
            const processingStatus = keyManager.signEvent({
              ...keyManager.createEventTemplate(7000),
              tags: [
                ['status', 'processing'],
                ['e', event.id],
                ['p', event.pubkey],
              ],
            });
            await this.relayHandler.publishEvent(processingStatus);

            try {
              const result = await this.mcpPool.callTool(
                jobRequest.name,
                jobRequest.parameters
              );
              const successStatus = keyManager.signEvent({
                ...keyManager.createEventTemplate(7000),
                tags: [
                  ['status', 'success'],
                  ['e', event.id],
                  ['p', event.pubkey],
                ],
              });
              await this.relayHandler.publishEvent(successStatus);
              const response = keyManager.signEvent({
                ...keyManager.createEventTemplate(6910),
                content: JSON.stringify(result),
                tags: [
                  ['request', JSON.stringify(event)],
                  ['e', event.id],
                  ['p', event.pubkey],
                ],
              });
              await this.relayHandler.publishEvent(response);
            } catch (error) {
              const errorStatus = keyManager.signEvent({
                ...keyManager.createEventTemplate(7000),
                tags: [
                  [
                    'status',
                    'error',
                    error instanceof Error ? error.message : 'Unknown error',
                  ],
                  ['e', event.id],
                  ['p', event.pubkey],
                ],
              });
              await this.relayHandler.publishEvent(errorStatus);
            }
          }
        }
      } else {
        const errorStatus = keyManager.signEvent({
          ...keyManager.createEventTemplate(7000),
          content: 'Unauthorized: Pubkey not in whitelist',
          tags: [
            ['status', 'error'],
            ['e', event.id],
            ['p', event.pubkey],
          ],
        });
        await this.relayHandler.publishEvent(errorStatus);
      }
    } catch (error) {
      console.error('Error handling request:', error);
    }
  }
}

if (import.meta.main) {
  const bridge = new DVMBridge();

  const shutdown = async () => {
    console.log('Shutting down...');
    try {
      await bridge.stop();
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await bridge.start();
  } catch (error) {
    console.error('Failed to start service:', error);
    process.exit(1);
  }
}
