import { Bonjour, Service } from 'bonjour-service';
import type { DeviceRegistry } from '../deviceRegistry.js';
import { SSC_PORT, sennheiserDeviceId } from './sennheiser.js';

type ServiceInfo = InstanceType<typeof Service>;

/**
 * Dante's own mDNS/DNS-SD advertisement. Dante carries no control-plane info
 * over mDNS — this only confirms a Dante device exists at an address; vendor
 * identity comes from the vendor adapters. These are UDP services only: Dante
 * does not advertise them over TCP, so browsing them over TCP (as this file
 * used to) only ever ran two idle browsers (MicWizard a52ebe3).
 */
const DANTE_SERVICE_TYPES = ['netaudio-arc', 'netaudio-chan'] as const;

/**
 * Sennheiser digital receivers (EW-DX, Digital 6000/9000) advertise SSC as
 * `_ssc._tcp`, per Sennheiser's published SSC integration notes — not yet
 * verified against a real receiver here. mDNS only says an address and port
 * exist; the SSC connection (sennheiser.ts) is what reads channels, battery
 * and RF, so each sighting is handed to `onSennheiserFound`.
 */
const SENNHEISER_SSC_SERVICE_TYPE = 'ssc';

export interface MdnsDiscoveryHandle {
  stop: () => void;
}

/**
 * @param onSennheiserFound called for every SSC sighting — the first `up` and
 * again on every refresh while the service is still advertised. The caller
 * dedupes by address (SennheiserConnections), and the repeat is what lets a
 * receiver that dropped its connection be reconnected without a restart.
 */
export function startMdnsDiscovery(
  registry: DeviceRegistry,
  onSennheiserFound: (address: string, port: number) => void = () => {}
): MdnsDiscoveryHandle {
  const bonjour = new Bonjour();

  const sscBrowser = bonjour.find({ type: SENNHEISER_SSC_SERVICE_TYPE, protocol: 'tcp' });
  sscBrowser.on('up', (service: ServiceInfo) =>
    handleSennheiserService(registry, service, onSennheiserFound)
  );
  sscBrowser.on('down', (service: ServiceInfo) => {
    // Only the placeholder goes. A receiver whose SSC connection is up owns its
    // own entry, and that connection ending is what clears it.
    const address = serviceAddress(service);
    if (!address) return;
    const id = sennheiserDeviceId(address);
    if (registry.get(id)?.identified === false) registry.remove(id);
  });

  const danteBrowsers = DANTE_SERVICE_TYPES.map((type) => {
    const browser = bonjour.find({ type, protocol: 'udp' });
    browser.on('up', (service: ServiceInfo) => handleDanteService(registry, service));
    browser.on('down', (service: ServiceInfo) => registry.remove(serviceId(service)));
    return browser;
  });

  /**
   * Re-assert every service still being advertised, and re-query for them.
   *
   * `up` fires once per service, but the registry's pruneStale() drops anything
   * not re-upserted within its window — so a Dante box that was still sitting
   * there happily advertising itself silently disappeared from the list a couple
   * of minutes after it was found. Vendor adapters never hit this because their
   * metering re-upserts constantly; an mDNS-only device has nothing else touching
   * it.
   *
   * Reading each browser's own list rather than a cache of our own is what keeps
   * this honest: bonjour expires a service on TTL or a goodbye packet and stops
   * returning it, so a device that really has gone stops being refreshed and is
   * pruned as intended.
   */
  const refreshTimer = setInterval(() => {
    sscBrowser.update();
    for (const service of sscBrowser.services) {
      handleSennheiserService(registry, service, onSennheiserFound);
    }
    for (const browser of danteBrowsers) {
      browser.update();
      for (const service of browser.services) handleDanteService(registry, service);
    }
  }, REFRESH_INTERVAL_MS);

  return {
    stop: () => {
      clearInterval(refreshTimer);
      sscBrowser.stop();
      for (const browser of danteBrowsers) browser.stop();
      bonjour.destroy();
    },
  };
}

/** Comfortably inside the registry's 120s staleness window, so a live device never
 *  gets close to being pruned, without re-querying the network constantly. */
const REFRESH_INTERVAL_MS = 30_000;

function serviceId(service: ServiceInfo): string {
  return `mdns:${service.fqdn}`;
}

function serviceAddress(service: ServiceInfo): string | undefined {
  return service.referer?.address ?? service.addresses?.[0];
}

function handleSennheiserService(
  registry: DeviceRegistry,
  service: ServiceInfo,
  onSennheiserFound: (address: string, port: number) => void
): void {
  const address = serviceAddress(service);
  if (!address) return;
  const port = service.port || SSC_PORT;

  // A placeholder under the same id the SSC connection uses, so the two merge
  // into one card instead of the receiver appearing twice. Once SSC has
  // identified it the connection owns the entry: re-upserting the mDNS
  // instance name here would overwrite the receiver's own name every refresh.
  const id = sennheiserDeviceId(address);
  if (!registry.get(id)?.identified) {
    registry.upsert({
      id,
      vendor: 'sennheiser',
      name: service.name,
      address,
      port,
      transport: 'none',
    });
  }
  onSennheiserFound(address, port);
}

function handleDanteService(registry: DeviceRegistry, service: ServiceInfo): void {
  const address = serviceAddress(service);
  if (!address) return;

  registry.upsert({
    id: serviceId(service),
    vendor: 'unknown-dante',
    name: service.name,
    address,
    port: service.port,
    transport: 'aes67',
  });
}
