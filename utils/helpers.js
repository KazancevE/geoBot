// Вспомогательные функции

function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours}ч ${mins}мин` : `${mins}мин`;
}

function formatDistance(meters) {
  return meters > 1000 ? `${(meters / 1000).toFixed(1)} км` : `${Math.round(meters)} м`;
}

function calculateRouteStats(route) {
  let totalDistance = 0;
  let totalTime = 0;
  
  for (let i = 0; i < route.length - 1; i++) {
    // Расчет расстояния и времени между точками
    const distance = calculateHaversineDistance(route[i], route[i + 1]);
    const time = distance / 500 * 60; // Предполагаем среднюю скорость 30 км/ч
    
    totalDistance += distance;
    totalTime += time;
  }
  
  return { totalDistance, totalTime };
}

module.exports = {
  formatDuration,
  formatDistance,
  calculateRouteStats
};