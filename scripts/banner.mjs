export function printBanner() {
  const color = process.stdout.isTTY && !process.env.NO_COLOR;
  const green = color ? '\x1b[92m' : '';
  const reset = color ? '\x1b[0m' : '';
  console.log(green + String.raw`
  +----------------------------------------------------+
  |  []  OSINT                                         |
  |  []  BUSINESS_                                     |
  |                                                    |
  |  ENTREPRISES FRANCAISES / SOURCES / CONNEXIONS        |
  +----------------------------------------------------+
` + reset);
}
