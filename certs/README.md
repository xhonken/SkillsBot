# Bambu Printer CA Bundle

`bambu-printer-ca.crt` is the complete public printer CA bundle from [Bambu Studio's `resources/cert/printer.cer`](https://github.com/bambulab/BambuStudio/blob/master/resources/cert/printer.cer), retrieved on 2026-10-04. It contains five certificates. The local onboarding wizard uses it with certificate verification enabled and the printer's serial number as the TLS server name.

Keep the complete bundle when updating it. Existing installations may reference their own trusted CA files; refreshing printer metadata preserves those explicit TLS settings.
