// Open Location Code ("plus code") encoder, so SOS messages carry a code that
// works without internet or street addresses.
const ALPHABET = "23456789CFGHJMPQRVWX";

export function plusCode(lat: number, lng: number, length = 10): string {
  lat = Math.min(90, Math.max(-90, lat));
  if (lat === 90) lat -= 0.000125;
  lng = ((((lng + 180) % 360) + 360) % 360) - 180;
  let latVal = Math.floor((lat + 90) * 8000);
  let lngVal = Math.floor((lng + 180) * 8000);
  const pairs: string[] = [];
  for (let i = 0; i < 5; i++) {
    const latDigit = latVal % 20;
    const lngDigit = lngVal % 20;
    pairs.unshift(ALPHABET[latDigit] + ALPHABET[lngDigit]);
    latVal = Math.floor(latVal / 20);
    lngVal = Math.floor(lngVal / 20);
  }
  const code = pairs.join("");
  return code.slice(0, 8) + "+" + code.slice(8, length);
}
