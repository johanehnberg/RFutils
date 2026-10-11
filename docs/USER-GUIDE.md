# RFutils user guide

RFutils is **a browser-based toolkit for radio-mic frequency coordination**. It replaces three
separate tools with one app: file conversion between Shure and Sennheiser ecosystems, Ofcom PMSE
licence import, live receiver monitoring, intermodulation-clean coordination, allocation, and
programming receivers.

**MicWizard and wsm-wwb-bridge are retired in favour of RFutils**, which now does everything they
did. If you used either, start with [Coming from MicWizard or wsm-wwb-bridge](#coming-from-micwizard-or-wsm-wwb-bridge).

> **Before you rely on this for a show:** most of the file formats RFutils reads and writes are
> *reverse-engineered from real exports*, because neither Shure nor Sennheiser publishes full
> specifications for them. **Open every export in your own copy of Wireless Workbench or WSM and
> check it before the show.** Treat anything marked experimental as exactly that.

---

## The tabs

| Tab | What it's for | Needs the local app |
|---|---|---|
| **Convert** | Move coordination data between Shure Wireless Workbench (WWB) and Sennheiser Wireless Systems Manager (WSM), in and out of plain CSV, or turn an Ofcom PMSE licence schedule PDF into importable frequency data — one drop zone, the file's type is detected | no |
| **Inventory** | Keep a list of the receivers and transmitters you own | no |
| **Coordination** | Calculate an intermodulation-clean set of frequencies | no |
| **Allocation** | Work out which frequencies go to which channel | no |
| **Monitor** | Discover Shure/Sennheiser/AES67 receivers and watch audio, battery and RF | **yes** |
| **Deployment** | Push assignments out to real receivers | **yes** |

> **Monitor and Deployment need sockets a browser tab cannot open**, so they only appear in the
> desktop/self-hosted build. The hosted version at
> [rfutils.stoatworks-labs.com](https://rfutils.stoatworks-labs.com) runs everything else entirely
> on your own machine — nothing you load is uploaded anywhere.

---

## Running it

### As a desktop app

RFutils ships as a tray application (built on av-launcher, with a Node runtime embedded). Start
it, pick a network interface and port, press **Start**, then **Open**.

> **On macOS, if the app opens but the server never starts:** this is almost always Gatekeeper —
> though it should no longer happen with a released build, since the `.dmg` and `.pkg` are
> Developer ID-signed and notarised. On a copy you built yourself, or an older download, the trap
> is that approving the *app* does not unquarantine the *helpers* bundled inside it; they are
> terminated silently, with no error shown. `xattr -dr com.apple.quarantine` on the whole bundle
> clears it.

### From source

```bash
npm install
npm run dev
```

Then open **http://localhost:8420**.

**No hardware? Use demo mode:**

```bash
npm run dev:demo
```

This runs with simulated receivers, so you can explore discovery, monitoring and the whole UI
without a single real device on the network. It is also the fastest way to tell an app problem
from a network problem.

---

## Coming from MicWizard or wsm-wwb-bridge

| You used | Now use | What changes |
|---|---|---|
| **wsm-wwb-bridge** | **Convert** | Nothing you need to do. The same formats in and out, the same column-mapping step for an unfamiliar CSV, and the same output byte for byte — RFutils is tested against the bridge's own results. It also runs in the hosted page, with no install. |
| **MicWizard** | **Monitor** | It runs in your browser: open it on the same machine as `http://localhost:8420`. Your Companion setup moves (below), and USB-input mappings need setting once more. |

### Moving your Companion setup from MicWizard

MicWizard kept `companion-routes.json` in its own app folder:

- macOS: `~/Library/Application Support/MicWizard/`
- Windows: `%APPDATA%\MicWizard\`
- Linux: `~/.config/MicWizard/`

RFutils reads it from `~/.rfutils/` instead (or the folder set in `RFUTILS_CONFIG_DIR`). The file
itself has not changed, so your Companion buttons keep working once it is there:

- **The easy way:** go to **Monitor**. While RFutils has no Companion setup of its own and
  MicWizard's file is still on the machine, the Dante routing panel shows **Import from MicWizard**.
  It copies the file across once, checks it first, leaves the original where it is, and never
  overwrites a setup RFutils already has.
- **By hand (macOS):** `mkdir -p ~/.rfutils && cp ~/Library/Application\ Support/MicWizard/companion-routes.json ~/.rfutils/`

### USB inputs

MicWizard remembered which USB-interface input each analogue receiver was patched into inside its
own window, so those mappings don't come across. In **Monitor**, click 🎧 on each such channel once
and choose the input again (see [Listening on headphones](#listening-on-headphones)).

---

## Converting a coordination file

1. Go to **Convert**.
2. Drop in your `.shw`/`.cws`, WSM export or CSV. The format is detected automatically — there
   is nothing to choose first, and the same zone takes a licence PDF (next section).
3. For a plain CSV, RFutils reads the header and suggests which column is which. **Check the
   suggested mapping** — it is a best guess from the column names. If it could guess nothing,
   the table starts empty and fills in as you map the name and frequency columns.
4. Choose your export format and download.
5. **Open the result in WWB or WSM and confirm it looks right** before using it.

![The Convert tab with a coordination file loaded.](screenshots/convert-coordination.png)

---

## Importing an Ofcom PMSE licence

1. Go to **Convert**.
2. Drop in the licence schedule PDF exactly as Ofcom issued it. RFutils recognises a PDF from its
   contents, so it doesn't matter what the file is called or whether it still has its `.pdf`
   extension.
3. If you get *"No frequency assignments were found in this PDF"*, the file was readable but
   isn't the expected document — check you have uploaded the schedule itself rather than a
   covering letter or a re-saved copy.
4. Export to your coordination software.

![The PMSE licence converter, with the parsed assignments from a licence schedule.](screenshots/convert-pmse.png)

This parser **has been validated against a real Ofcom licence**, which is more than can be said
for most of the formats here.

---

## Coordination

Computes a set of mutually-compatible frequencies — spaced, clear of excluded spectrum, and free
of third and fifth-order intermodulation products.

![The Coordination tab: equipment profile, band preset, tuning ranges, spacing and guard settings, and the IM order checkboxes.](screenshots/coordination.png)

Pick an **equipment profile** and a **band preset** and the spacing defaults follow from the
profile — the note under the selector states the occupied bandwidth and recommended spacing it is
assuming, and tells you to verify it against your own unit.

**Locked / existing** is the field that matters on a site where somebody else is already on air:
frequencies you put there are treated as immovable and everything else is coordinated around
them.

---

## Inventory

The receivers and transmitters you own, so coordination and allocation have something real to work
against.

![The Inventory tab.](screenshots/inventory.png)

> **Saving inventory replaces the whole list** rather than merging into it — the app always writes
> the complete set.

---

## Monitor

Discovers Shure, Sennheiser and AES67/Dante receivers on the local network and meters audio,
battery and RF per channel in real time.

![The Monitor tab: receivers grouped by vendor, with audio and RF meters, battery percentage and runtime per channel, and the Dante routing panel underneath.](screenshots/monitor.png)

*Captured against `npm run dev:demo`, so the receivers are simulated.*

If nothing appears: RFutils and the receivers must be on the same subnet, discovery must not be
blocked by a firewall, and the wireless network must not be isolating clients from each other.

> **What has and hasn't run on real hardware.** None of the Monitor adapters has been run against
> a real receiver yet. Shure discovery and metering follow Shure's published Command Strings and
> now cope with channel names that contain spaces. Sennheiser receivers found on the network are
> now connected to and read every second, but what RFutils asks them for is a best guess at
> Sennheiser's SSC paths and has only been tested against a simulated receiver. If you have either
> on hand, a short capture helps (see the [capture guide](capture-guide.md)).

### Listening on headphones

Every channel has a 🎧 button, and the **Headphone cue** bar above the receivers controls how it
plays:

- **Solo** (ticked by default): one channel at a time — clicking 🎧 on another replaces the
  first. Untick it to **mix** several; each playing channel shows its own level next to its 🎧.
- **Output**: choose headphones, a USB interface or any other output your computer has. This works
  in Chrome and Edge; Safari and Firefox always use the system output, and the bar says so.
  **Show device names** appears while the browser is still hiding them — it asks once for
  microphone permission, which is the only way a browser will reveal them.
- **Stop all** stops every cue.

Where the sound comes from depends on the channel:

- **Dante / AES67 channels** play straight away (the RFutils server relays them).
- **With a Dante interface set up for capture** (see the README), any channel plays: RFutils asks
  Companion to route it to the cue bus. There is one cue bus, so in Mix those channels still
  replace each other.
- **A receiver with no network audio** — an analogue unit patched into a USB audio interface — is
  set up once: click its 🎧 (shown with a dashed border), choose the interface, and pick either
  the whole device or the one input the receiver is plugged into. From then on 🎧 plays that
  input. The choice is remembered by this browser; **×** next to the button forgets it.

> **Open RFutils at `http://localhost:8420` on the machine it runs on** if you want to listen.
> Browsers only allow audio devices on a secure page, which `localhost` is and an address like
> `http://192.168.1.20:8420` is not. From another computer, the cue — and only the cue — is
> unavailable; the bar explains this rather than failing silently.

Solo and Mix, the output choice and the USB path have been tried with simulated devices in
Chrome, but not yet with a real USB interface, a real receiver or Safari/Firefox.

### Dante routing

**Dante routing is off unless you set it up.** RFutils only monitors by default; routing channels
from here needs your own Bitfocus Companion with a "Make Crosspoint" button and a
`companion-routes.json` in `~/.rfutils/`. The panel says so when it is not configured — and offers
**Import from MicWizard** if MicWizard's copy of that file is still on the machine.

---

## Deployment — read this before you press it

**Deployment sends commands to real receivers, which may be in use.**

![The Deployment tab: allocated frequencies mapped to device channels, with the dry-run output showing the exact command strings that would be sent.](screenshots/deployment.png)

**Dry-run** shows exactly what would be transmitted — the address, the literal command string,
and "would send" against each one — without transmitting anything. **Program devices** is the
separate, deliberately distinct button that actually sends.

> **Live Shure programming is experimental and untested against hardware.** The dry-run output
> exists so you can check the exact command strings against your receiver's own Command Strings
> PDF before sending. Do that.

Supported control transports today are Shure command strings and the Lectrosonics network
protocol. Devices matching neither are listed with no transport and will not be programmed. The
same screen also exports files for offline programming, which is the safe route.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| **Nothing is discovered in Monitor** | Same subnet, firewall, or client isolation on wireless. Run `npm run dev:demo` — if simulated devices appear, the app is fine and the problem is the network. |
| **Monitor and Deployment tabs are missing** | You are on the hosted build. Those two need the local app. |
| **A CSV imports with the wrong values in the wrong fields** | The column mapping guessed wrong. Re-import and set it by hand. |
| **An export doesn't look right in WWB/WSM** | Expected occasionally — these formats are reverse-engineered. Please report it with a sample file. |
| **Coordination returns fewer frequencies than asked for** | The constraints are unsatisfiable in that range. Widen the tuning ranges, reduce spacing, or drop 5th-order avoidance. |
| **Frequencies clash with someone already on air** | Put theirs in **Locked / existing** and coordinate again. |
| **The port is already in use** | Set `RFUTILS_SERVER_PORT` to something else. |
| **I just want the converters** | Set `RFUTILS_DISABLE_MONITOR=1`, or run `npm run dev:verify`. |
| **🎧 says cueing needs a secure page** | RFutils was opened by its network address. Open it as `http://localhost:8420` on the machine it runs on. |
| **🎧 on a USB-mapped channel says the input is not connected** | The interface was unplugged or the browser renamed it. Replug it, or press **×** and map the channel again. |
| **No sound, but the 🎧 level is moving** | Check the **Output** in the cue bar — the sound may be going to another device. |
| **Something else went wrong** | Collect diagnostics (next section) and attach the file to your report. |

### Collecting diagnostics

At the bottom of every page, open **Diagnostics** and press **Collect diagnostics**. Your browser
downloads one file holding the logs, the app version, your settings with any passwords removed,
and details of any recent crash; attach it to your bug report. A copy also stays on the machine
RFutils runs on — **Open log folder** shows it (on macOS it is in `~/Library/Logs/rfutils/`,
which Finder hides by default).

---

## Where your data lives, and who can reach it

Inventory is stored server-side in the local app.

> **There is no authentication, and the server listens on all interfaces by default.** On a shared
> or untrusted network, bind it to `127.0.0.1` or firewall the port — otherwise anyone who can
> reach it can read your inventory and **send commands to your receivers**.

---

## See also

- [README](../README.md) — what it is, the three tools it replaces, and downloads
- [wsm-wwb-bridge](https://github.com/stoatworks-labs/wsm-wwb-bridge) — the standalone Python
  predecessor of the Convert tab, now retired in favour of it
- [MicWizard](https://github.com/stoatworks-labs/MicWizard) — the Electron predecessor of the
  Monitor tab, now retired in favour of it
