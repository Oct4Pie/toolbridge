/**
 * Port Manager for Integration Tests
 * 
 * Manages dynamic port allocation to prevent conflicts when running
 * multiple integration tests that spawn servers simultaneously.
 * 
 * Port ranges are configured via testConfigLoader (from config.json or environment variables)
 */

import * as net from 'net';

import { testConfigLoader } from './testConfigLoader.js';

class PortManager {
  private static instance: PortManager;
  private usedPorts: Set<number> = new Set();
  private basePort: number;
  private maxPort: number;

  private constructor() {
    const config = testConfigLoader.getConfig();
    this.basePort = config.server.portRangeStart;
    this.maxPort = config.server.portRangeEnd;
    
    // Validate port range
    if (this.basePort >= this.maxPort) {
      throw new Error(
        `Invalid port range: basePort (${this.basePort}) must be less than maxPort (${this.maxPort})`
      );
    }
  }

  static getInstance(): PortManager {
    if (!PortManager.instance) {
      PortManager.instance = new PortManager();
    }
    return PortManager.instance;
  }

  /**
   * Get an available port from the pool
   */
  async getAvailablePort(): Promise<number> {
    for (let port = this.basePort; port <= this.maxPort; port++) {
      if (!this.usedPorts.has(port)) {
        const isAvailable = await this.isPortAvailable(port);
        if (isAvailable) {
          this.usedPorts.add(port);
          return port;
        }
      }
    }
    throw new Error('No available ports in range');
  }

  /**
   * Release a port back to the pool
   */
  releasePort(port: number): void {
    this.usedPorts.delete(port);
  }

  /**
   * Check if a port is actually available on the system
   */
  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.once('error', () => {
        resolve(false);
      });
      
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      
      server.listen(port, '127.0.0.1');
    });
  }

  /**
   * Get information about the configured port range
   * @returns Object with start and end port numbers from config
   */
  getPortRangeInfo(): { start: number; end: number } {
    return {
      start: this.basePort,
      end: this.maxPort,
    };
  }

  /**
   * Reset all ports (useful for test cleanup)
   */
  reset(): void {
    this.usedPorts.clear();
  }
}

/**
 * Helper function to get a port for a test
 */
export async function getTestPort(): Promise<number> {
  return PortManager.getInstance().getAvailablePort();
}

/**
 * Helper function to release a port after test
 */
export function releaseTestPort(port: number): void {
  PortManager.getInstance().releasePort(port);
}

/**
 * Direct access to port manager instance (use helpers above instead)
 */
export const portManager = PortManager.getInstance();

/**
 * Check if a port is listening
 */
function checkPortListening(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();

    // Use socket timeout from config
    const config = testConfigLoader.getConfig();
    socket.setTimeout(config.timeouts.socket);

    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, host);
  });
}

/**
 * Wait for a port to be listening
 */
export async function waitForPort(port: number, host: string = 'localhost', timeout: number = 30000): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const isListening = await checkPortListening(port, host);
      if (isListening) {
        return;
      }
    } catch {
      // Port not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error(`Port ${port} not listening after ${timeout}ms`);
}
