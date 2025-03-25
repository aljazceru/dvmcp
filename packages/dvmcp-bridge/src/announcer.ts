import type { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import { CONFIG } from './config';
import { createKeyManager } from '@dvmcp/commons/nostr/key-manager';
import type { MCPPool } from './mcp-pool';
import { relayHandler } from './relay';
import {
  DVM_ANNOUNCEMENT_KIND,
  TOOL_REQUEST_KIND,
} from '@dvmcp/commons/constants';
import type { Event } from 'nostr-tools/pure';

export const keyManager = createKeyManager(CONFIG.nostr.privateKey);

export class NostrAnnouncer {
  private relayHandler: RelayHandler;
  private mcpPool: MCPPool;

  constructor(mcpPool: MCPPool) {
    this.relayHandler = relayHandler;
    this.mcpPool = mcpPool;
  }

  async announceRelayList() {
    const event = keyManager.signEvent({
      ...keyManager.createEventTemplate(10002),
      content: '',
      tags: CONFIG.nostr.relayUrls.map((url) => ['r', url]),
    });

    await this.relayHandler.publishEvent(event);
    console.log('Announced relay list metadata');
  }

  async announceService() {
    const tools = await this.mcpPool.listTools();
    const event = keyManager.signEvent({
      ...keyManager.createEventTemplate(DVM_ANNOUNCEMENT_KIND),
      content: JSON.stringify({
        name: CONFIG.mcp.name,
        about: CONFIG.mcp.about,
        picture: CONFIG.mcp.picture,
        website: CONFIG.mcp.website,
        banner: CONFIG.mcp.banner,
        tools: tools,
      }),
      tags: [
        ['d', `dvm-announcement-${CONFIG.mcp.clientName}`],
        ['k', `${TOOL_REQUEST_KIND}`],
        ['capabilities', 'mcp-1.0'],
        ['t', 'mcp'],
        ...tools.map((tool) => ['t', tool.name]),
      ],
    });
    await this.relayHandler.publishEvent(event);
    console.log(`Announced service with ${tools.length} tools`);
  }

  async updateAnnouncement() {
    await Promise.all([this.announceService(), this.announceRelayList()]);
  }

  /**
   * Deletes the service announcement from relays using NIP-09
   * @param reason Optional reason for deletion
   * @returns The deletion event that was published
   */
  async deleteAnnouncement(reason: string = 'Service offline'): Promise<Event> {
    // First, query the relays to find our announcement event
    const announcementFilter = {
      kinds: [DVM_ANNOUNCEMENT_KIND],
      authors: [keyManager.getPublicKey()],
    };
    
    const events = await this.relayHandler.queryEvents(announcementFilter);
    
    // Create the deletion event (NIP-09)
    const deletionEvent = keyManager.signEvent({
      ...keyManager.createEventTemplate(5), // kind 5 is for deletion requests
      content: reason,
      tags: [
        // Add tags for each event to be deleted
        ...events.map(event => ['e', event.id]),
        // Add the kind of events being deleted
        ['k', `${DVM_ANNOUNCEMENT_KIND}`],
      ],
    });
    
    // Publish the deletion event
    await this.relayHandler.publishEvent(deletionEvent);
    console.log(`Published deletion event for service announcement`);
    
    return deletionEvent;
  }
}
