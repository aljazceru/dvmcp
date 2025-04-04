import { DVMBridge } from './src/dvm-bridge';
import { loggerBridge } from '@dvmcp/commons/logger';

async function main() {
  const bridge = new DVMBridge();
  const shutdown = async () => {
    loggerBridge('Shutting down...');
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

export default main;
