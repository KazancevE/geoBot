class RouteOptimizer {
  // Алгоритм кластеризации K-Means для распределения точек между курьерами
  clusterByKMeans(points, k) {
    if (points.length <= k) {
      return points.map(p => [p]);
    }

    // Инициализация центроидов
    const centroids = [];
    for (let i = 0; i < k; i++) {
      const idx = Math.floor((i * points.length) / k);
      centroids.push({ lat: points[idx].lat, lon: points[idx].lon });
    }

    let clusters = Array(k).fill().map(() => []);
    let changed = true;
    let iterations = 0;

    while (changed && iterations < 100) {
      // Назначение точек ближайшему центроиду
      clusters = Array(k).fill().map(() => []);
      
      points.forEach(point => {
        let minDist = Infinity;
        let closestCentroid = 0;
        
        centroids.forEach((centroid, idx) => {
          const dist = this.calculateDistance(point, centroid);
          if (dist < minDist) {
            minDist = dist;
            closestCentroid = idx;
          }
        });
        
        clusters[closestCentroid].push(point);
      });

      // Пересчет центроидов
      changed = false;
      centroids.forEach((centroid, idx) => {
        if (clusters[idx].length > 0) {
          const newLat = clusters[idx].reduce((sum, p) => sum + p.lat, 0) / clusters[idx].length;
          const newLon = clusters[idx].reduce((sum, p) => sum + p.lon, 0) / clusters[idx].length;
          
          if (Math.abs(newLat - centroid.lat) > 0.0001 || Math.abs(newLon - centroid.lon) > 0.0001) {
            changed = true;
            centroid.lat = newLat;
            centroid.lon = newLon;
          }
        }
      });
      
      iterations++;
    }

    return clusters.filter(cluster => cluster.length > 0);
  }

  // Расчет расстояния между двумя точками (формула гаверсинусов)
  calculateDistance(point1, point2) {
    const R = 6371000; // радиус Земли в метрах
    const lat1 = point1.lat * Math.PI / 180;
    const lat2 = point2.lat * Math.PI / 180;
    const deltaLat = (point2.lat - point1.lat) * Math.PI / 180;
    const deltaLon = (point2.lon - point1.lon) * Math.PI / 180;

    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  // Алгоритм ближайшего соседа для построения маршрута внутри кластера
  nearestNeighborRoute(points, startPoint = null, endPoint = null) {
    if (points.length === 0) return [];
    
    const route = [];
    const unvisited = [...points];
    
    // Начальная точка
    let current = startPoint || unvisited.shift();
    route.push(current);
    
    while (unvisited.length > 0) {
      let nearestIndex = 0;
      let nearestDistance = this.calculateDistance(current, unvisited[0]);
      
      for (let i = 1; i < unvisited.length; i++) {
        const distance = this.calculateDistance(current, unvisited[i]);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = i;
        }
      }
      
      current = unvisited.splice(nearestIndex, 1)[0];
      route.push(current);
    }
    
    // Добавляем конечную точку если указана
    if (endPoint) {
      route.push(endPoint);
    }
    
    return route;
  }

  // Оптимизация маршрутов с учетом вместимости курьеров
  optimizeWithCapacities(addresses, couriers) {
    const sortedCouriers = [...couriers].sort((a, b) => b.capacity - a.capacity);
    const sortedAddresses = [...addresses].sort((a, b) => b.weight - a.weight);
    
    const assignments = {};
    sortedCouriers.forEach(c => assignments[c.name] = []);
    
    // Распределение адресов с учетом вместимости
    sortedAddresses.forEach(address => {
      for (const courier of sortedCouriers) {
        const currentLoad = assignments[courier.name].reduce((sum, addr) => sum + addr.weight, 0);
        if (currentLoad + address.weight <= courier.capacity) {
          assignments[courier.name].push(address);
          break;
        }
      }
    });
    
    return assignments;
  }

  // Определение оптимального количества курьеров
  calculateOptimalCourierCount(addresses, couriers) {
    if (addresses.length === 0) return 0;
    
    const totalWeight = addresses.reduce((sum, addr) => sum + (addr.weight || 1), 0);
    const avgCourierCapacity = couriers.reduce((sum, c) => sum + c.capacity, 0) / couriers.length;
    
    // Минимальное количество курьеров по весу
    const minByWeight = Math.ceil(totalWeight / avgCourierCapacity);
    
    // Учитываем географическую разбросанность
    const clusters = this.clusterByKMeans(addresses, couriers.length);
    const validClusters = clusters.filter(c => c.length > 0).length;
    
    return Math.min(Math.max(minByWeight, validClusters), couriers.length);
  }
}

module.exports = new RouteOptimizer();