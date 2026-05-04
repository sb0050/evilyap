# Encoding Rules

## File Encoding
- Always read files using UTF-8 encoding without BOM.
- Always write files using UTF-8 encoding without BOM.
- Never change the encoding of an existing file.

## Constraints
- Do not introduce BOM under any circumstance.
- Do not convert files to another encoding (e.g., ISO-8859-1, Windows-1252).
- Preserve the original encoding if it is already UTF-8 without BOM.

## Validation
- Before saving any file, ensure it is encoded in UTF-8 without BOM.
- If a file is detected with a different encoding, do not modify it and raise a warning instead.
