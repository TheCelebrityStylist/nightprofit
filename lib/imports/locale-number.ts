export function parseLocaleNumber(value:string, locale:"nl-NL"|"en-US"){
  const trimmed=value.trim().replace(/\s/g,"");if(!trimmed)throw new Error("EMPTY_NUMBER");
  const normalised=locale==="nl-NL"?trimmed.replace(/\./g,"").replace(",","."):trimmed.replace(/,/g,"");
  if(!/^-?\d+(\.\d+)?$/.test(normalised))throw new Error("INVALID_NUMBER");
  return normalised;
}
export function decimalToMinor(value:string,locale:"nl-NL"|"en-US"){
  const normalised=parseLocaleNumber(value,locale);const negative=normalised.startsWith("-");const [whole,fraction=""]=normalised.replace("-","").split(".");
  const minor=BigInt(whole)*100n+BigInt((fraction+"00").slice(0,2));return negative?-minor:minor;
}
