# Printer Compatibility

The brand catalog is separate from connection adapters. Select the protocol actually exposed by the printer or its connected host. A model without one of the APIs below needs an additional adapter; setting its brand cannot provide connectivity.

| Brand / family | Available connection          | Conditions                                                                                         |
| -------------- | ----------------------------- | -------------------------------------------------------------------------------------------------- |
| Bambu Lab      | `bambu`                       | Accessible TLS MQTT telemetry, printer serial number and LAN access code; test model and firmware. |
| Prusa          | `prusalink`, `octoprint`      | PrusaLink v1 status API, or a printer connected through OctoPrint.                                 |
| Creality       | `moonraker`, `octoprint`      | An accessible Moonraker/Klipper installation, or an OctoPrint-compatible connection.               |
| Anycubic       | `moonraker`, `octoprint`      | An installation exposing one of these APIs; proprietary resin/cloud APIs are not included.         |
| Elegoo         | `moonraker`, `octoprint`      | Compatible Klipper/FDM setup; proprietary resin status is not included.                            |
| Sovol          | `moonraker`, `octoprint`      | An installation exposing the chosen API.                                                           |
| QIDI           | `moonraker`, `octoprint`      | An installation exposing the chosen API, including the actual configured port.                     |
| Flashforge     | External compatible host only | No native Flashforge adapter; use OctoPrint only if the particular printer/host supports it.       |
| UltiMaker      | External compatible host only | No native UltiMaker adapter; proprietary native networking is not implemented.                     |
| Voron          | `moonraker`, `octoprint`      | Voron is a community project, normally paired with Klipper/Moonraker.                              |

These conditions describe implemented protocols, not hardware acceptance results. The example file deliberately includes only usable adapter patterns; it does not invent native Flashforge or UltiMaker connections.

## API behavior

- **Bambu MQTT:** Subscribe to `device/<serial>/report`; request a full report using `pushing.command = pushall`. Read `print.gcode_state`, `mc_percent`, `mc_remaining_time` (minutes), `print_error`, `hms`, and `ams.ams[].tray[]`. Merge partial reports by AMS/tray ID, ignore retained reports, close connections on completion or timeout. The default timeout is 10 seconds. Raw error/HMS codes are preserved; no speculative error description is generated.
- **Bambu onboarding:** Send one targeted UDP `M-SEARCH` request to the supplied host on port 1990. Read `USN` and `DevName.bambu.com`; check the source address and any supplied serial. Discovery has a 2.5-second timeout and manual fallback. Authenticate using verified TLS MQTT, request `info.command = get_version` alongside telemetry, and store only printer metadata and AMS modules. No buffer, exhaust-fan or internal controller metadata is saved. Onboarding uses a 15-second MQTT timeout and only saves after a successful check.
- **Moonraker:** GET `/printer/objects/query?print_stats&virtual_sdcard&display_status&webhooks`. Use actual state, Klipper error messages and progress. Remaining time is an elapsed-time/progress estimate, so it can vary with layers, pauses and speed changes. API-key authentication is optional when the host allows trusted clients.
- **OctoPrint:** GET `/api/job`, including `state`, `error`, `progress.completion` and `progress.printTimeLeft`. API keys use `X-Api-Key`.
- **PrusaLink:** GET `/api/v1/status`, including printer state, status messages, job progress and seconds remaining. API-key or supported MD5/SHA-256 Digest authentication can be configured. Older installations without the v1 endpoint need another adapter or firmware support.

HTTP timeouts default to eight seconds and apply while reading the body. Responses are limited to 1 MiB and redirects are rejected. Per-printer `timeoutMs` can be set between 100 and 60000. `enabled: false` prevents network queries and excludes a printer from `all`.

## AMS limitations

Every reported AMS unit and tray is listed, without a fixed four-unit limit. Material and remaining percentage depend on printer firmware, AMS model, filament identification and whether estimates are available. Missing, negative or out-of-range remaining values are unknown. Standard AMS IDs 0–3 use the printer's hexadecimal presence bitfield to avoid showing stale material in empty slots; other unit layouts retain reported tray data without guessing slot presence. Estimates are approximate and are not measured spool weight.

Bambu's authorization documentation distinguishes telemetry from print/control operations. This integration only monitors status and requests telemetry; it does not send print, motion, heater or AMS-setting commands. Developer-mode availability and requirements vary with model and firmware. Do not assume it is necessary solely to receive status pushes.

## Primary references

- [Bambu Studio telemetry parsing](https://github.com/bambulab/BambuStudio/blob/master/src/slic3r/GUI/DeviceManager.cpp) and [filament-system parsing](https://github.com/bambulab/BambuStudio/blob/master/src/slic3r/GUI/DeviceCore/DevFilaSystem.cpp).
- [LAN discovery header parsing](https://github.com/synman/bambu-printer-manager/blob/main/src/bpm/bambudiscovery.py).
- [Bambu firmware authorization and status monitoring](https://blog.bambulab.com/firmware-update-introducing-new-authorization-control-system-2/).
- [Bambu AMS HT RFID and remaining estimation](https://us.store.bambulab.com/collections/spare-parts-circuit-boards-ams-ht/products/ams-ht-rfid-coil).
- [Moonraker printer status API](https://moonraker.readthedocs.io/en/latest/external_api/printer/) and [printer objects](https://moonraker.readthedocs.io/en/latest/printer_objects/).
- [OctoPrint job operations](https://docs.octoprint.org/en/main/api/job.html).
- [PrusaLink API specification](https://github.com/prusa3d/Prusa-Link-Web/blob/master/spec/openapi.yaml).
- [Discord message-content intent](https://support-dev.discord.com/hc/en-us/articles/4404772028055-Message-Content-Privileged-Intent-FAQ).
