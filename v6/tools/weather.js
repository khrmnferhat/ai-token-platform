
'use strict';

const WEATHER_CODE = { 0: 'açık', 1: 'çoğunlukla açık', 2: 'parçalı bulutlu', 3: 'kapalı', 45: 'sisli', 48: 'donmuş sisli', 51: 'hafif çiseleme', 53: 'çiseleme', 55: 'yoğun çiseleme', 61: 'hafif yağmur', 63: 'yağmurlu', 65: 'şiddetli yağmur', 71: 'hafif kar', 73: 'kar', 75: 'yoğun kar', 80: 'sağanak', 95: 'gök gürültülü sağanak', 96: 'gök gürültülü dolu', 99: 'şiddetli gök gürültülü sağanak' };
const round = (value) => Math.round(Number(value));
const describeWeather = (code) => WEATHER_CODE[code] || 'değişken';
function periodFromText(text) { const value = String(text || '').toLocaleLowerCase('tr-TR'); if (/yarın|yarin|tomorrow/.test(value)) return 'tomorrow'; if (/hafta sonu|weekend/.test(value)) return 'weekend'; return 'today'; }
function dateForPeriod(period) { const date = new Date(); if (period === 'tomorrow') date.setDate(date.getDate() + 1); if (period === 'weekend') { const untilSaturday = (6 - date.getDay() + 7) % 7 || 7; date.setDate(date.getDate() + untilSaturday); } return date.toISOString().slice(0, 10); }
async function getJson(url, timeoutMs = 9000) { const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) }); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }
async function weather({ city, period = 'today' } = {}) {
  const cleanCity = String(city || '').trim();
  if (!cleanCity) return { ok: false, error: 'city_required', detail: 'Hava için şehir adı gerekiyor.' };
  const geocode = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cleanCity)}&count=1&language=tr&format=json`);
  const place = geocode.results && geocode.results[0];
  if (!place) return { ok: false, error: 'city_not_found', detail: `${cleanCity} için konum bulunamadı.` };
  const date = dateForPeriod(period);
  const forecast = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto&start_date=${date}&end_date=${date}`);
  const current = forecast.current || {}; const daily = forecast.daily || {}; const code = period === 'today' ? current.weather_code : daily.weather_code?.[0];
  const max = daily.temperature_2m_max?.[0]; const min = daily.temperature_2m_min?.[0]; const rain = daily.precipitation_probability_max?.[0];
  const label = period === 'tomorrow' ? 'yarın' : period === 'weekend' ? 'hafta sonu' : 'bugün';
  const detail = period === 'today' ? `${describeWeather(code)}, ${round(current.temperature_2m)}°C (hissedilen ${round(current.apparent_temperature)}°C), rüzgâr ${round(current.wind_speed_10m)} km/sa.` : `${describeWeather(code)}, ${round(min)}–${round(max)}°C, yağış olasılığı %${rain ?? 0}.`;
  return { ok: true, source: 'Open-Meteo', city: place.name, country: place.country, period: label, answer: `${place.name}, ${place.country}: ${detail}`, data: { date, code, temperature: current.temperature_2m, apparent: current.apparent_temperature, max, min, rain } };
}
module.exports = { weather, periodFromText, describeWeather };