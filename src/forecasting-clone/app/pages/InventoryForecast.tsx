import { useState } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  AreaChart,
  Area,
} from 'recharts';
import {
  Calendar,
  TrendingUp,
  Package,
  Clock,
  CheckCircle,
  AlertCircle,
  Sprout,
  ChevronRight,
} from 'lucide-react';

// Grass types
const grassTypes = ['Bermuda', 'Bentgrass', 'Kentucky Bluegrass', 'Zoysia', 'Fescue'];
const farms = ['Oak Ridge Farm', 'Meadowbrook Farm', 'Sunset Valley Farm', 'Highland Farm'];

// Harvest types with regrowth periods
const REGROWTH_PERIODS = {
  sod: 4, // months
  sprig: 1, // months
};

// Generate mock harvest history
const generateHarvestHistory = () => {
  const history = [];
  const today = new Date('2026-03-31');

  for (let i = 0; i < 20; i++) {
    const daysAgo = Math.floor(Math.random() * 120);
    const harvestDate = new Date(today);
    harvestDate.setDate(harvestDate.getDate() - daysAgo);

    const harvestType = Math.random() > 0.6 ? 'sod' : 'sprig';
    const grassType = grassTypes[Math.floor(Math.random() * grassTypes.length)];
    const farm = farms[Math.floor(Math.random() * farms.length)];
    const quantity = Math.floor(Math.random() * 15000) + 5000;

    const regrowthMonths = REGROWTH_PERIODS[harvestType];
    const readyDate = new Date(harvestDate);
    readyDate.setMonth(readyDate.getMonth() + regrowthMonths);

    const isReady = readyDate <= today;

    history.push({
      id: `H${1000 + i}`,
      farm,
      grassType,
      harvestType,
      harvestDate: harvestDate.toISOString().split('T')[0],
      readyDate: readyDate.toISOString().split('T')[0],
      quantity,
      isReady,
      daysUntilReady: isReady ? 0 : Math.ceil((readyDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
    });
  }

  return history.sort((a, b) => new Date(b.harvestDate).getTime() - new Date(a.harvestDate).getTime());
};

const harvestHistory = generateHarvestHistory();

// Calculate inventory by farm and grass type
const calculateInventory = () => {
  const inventory: any = {};

  farms.forEach((farm) => {
    inventory[farm] = {};
    grassTypes.forEach((grass) => {
      const harvests = harvestHistory.filter(
        (h) => h.farm === farm && h.grassType === grass && h.isReady
      );
      const available = harvests.reduce((sum, h) => sum + h.quantity, 0);
      inventory[farm][grass] = available;
    });
  });

  return inventory;
};

// Generate future availability forecast
const generateForecast = () => {
  const forecast = [];
  const today = new Date('2026-03-31');

  for (let month = 0; month <= 6; month++) {
    const forecastDate = new Date(today);
    forecastDate.setMonth(forecastDate.getMonth() + month);
    const dateStr = forecastDate.toISOString().split('T')[0];

    const entry: any = {
      date: dateStr,
      month: forecastDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
    };

    grassTypes.forEach((grass) => {
      const availableHarvests = harvestHistory.filter(
        (h) => h.grassType === grass && new Date(h.readyDate) <= forecastDate
      );
      entry[grass] = availableHarvests.reduce((sum, h) => sum + h.quantity, 0);
    });

    forecast.push(entry);
  }

  return forecast;
};

// Generate upcoming availability timeline
const generateTimeline = () => {
  const timeline = [];
  const today = new Date('2026-03-31');

  const futureHarvests = harvestHistory
    .filter((h) => !h.isReady && h.daysUntilReady <= 180)
    .sort((a, b) => a.daysUntilReady - b.daysUntilReady);

  const grouped: any = {};

  futureHarvests.forEach((h) => {
    const weekKey = Math.floor(h.daysUntilReady / 7);
    if (!grouped[weekKey]) {
      grouped[weekKey] = {
        weekStart: weekKey * 7,
        weekEnd: (weekKey + 1) * 7,
        harvests: [],
        totalQuantity: 0,
      };
    }
    grouped[weekKey].harvests.push(h);
    grouped[weekKey].totalQuantity += h.quantity;
  });

  return Object.values(grouped);
};

const GRASS_COLORS: any = {
  Bermuda: '#1F7A4C',
  Bentgrass: '#2E9B5F',
  'Kentucky Bluegrass': '#3EBC72',
  Zoysia: '#4FDD85',
  Fescue: '#60EE98',
};

export function InventoryForecast() {
  const [selectedFarm, setSelectedFarm] = useState<string | null>(null);
  const [selectedGrass, setSelectedGrass] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'current' | 'forecast' | 'timeline'>('current');

  const inventory = calculateInventory();
  const forecast = generateForecast();
  const timeline = generateTimeline();

  // Filter harvest history
  const filteredHistory = harvestHistory.filter((h) => {
    if (selectedFarm && h.farm !== selectedFarm) return false;
    if (selectedGrass && h.grassType !== selectedGrass) return false;
    return true;
  });

  // Calculate stats
  const totalAvailable = filteredHistory
    .filter((h) => h.isReady)
    .reduce((sum, h) => sum + h.quantity, 0);

  const totalGrowing = filteredHistory
    .filter((h) => !h.isReady)
    .reduce((sum, h) => sum + h.quantity, 0);

  const readyThisWeek = filteredHistory.filter(
    (h) => !h.isReady && h.daysUntilReady <= 7
  ).length;

  const readyNextMonth = filteredHistory.filter(
    (h) => !h.isReady && h.daysUntilReady <= 30
  ).length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <Calendar className="w-8 h-8 text-[#1F7A4C]" />
              <div>
                <h1 className="text-2xl sm:text-3xl font-semibold text-gray-900">
                  Inventory Forecast & Planning
                </h1>
                <p className="text-sm text-gray-600 mt-1">
                  Track regrowth and plan future harvests
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Key Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Available Now</span>
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <div className="text-3xl font-semibold text-gray-900">
              {(totalAvailable / 1000).toFixed(0)}K
            </div>
            <p className="text-xs text-gray-500 mt-1">sq. ft. ready to harvest</p>
          </div>

          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Growing</span>
              <Sprout className="w-5 h-5 text-yellow-600" />
            </div>
            <div className="text-3xl font-semibold text-gray-900">
              {(totalGrowing / 1000).toFixed(0)}K
            </div>
            <p className="text-xs text-gray-500 mt-1">sq. ft. in regrowth</p>
          </div>

          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Ready This Week</span>
              <Clock className="w-5 h-5 text-blue-600" />
            </div>
            <div className="text-3xl font-semibold text-gray-900">{readyThisWeek}</div>
            <p className="text-xs text-gray-500 mt-1">fields becoming available</p>
          </div>

          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Next 30 Days</span>
              <TrendingUp className="w-5 h-5 text-purple-600" />
            </div>
            <div className="text-3xl font-semibold text-gray-900">{readyNextMonth}</div>
            <p className="text-xs text-gray-500 mt-1">fields maturing soon</p>
          </div>
        </div>

        {/* View Mode Tabs */}
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setViewMode('current')}
            className={`px-4 py-2 rounded-lg border transition-colors ${
              viewMode === 'current'
                ? 'bg-[#1F7A4C] text-white border-[#1F7A4C]'
                : 'bg-white text-gray-700 border-gray-300 hover:border-[#1F7A4C]'
            }`}
          >
            Current Inventory
          </button>
          <button
            onClick={() => setViewMode('forecast')}
            className={`px-4 py-2 rounded-lg border transition-colors ${
              viewMode === 'forecast'
                ? 'bg-[#1F7A4C] text-white border-[#1F7A4C]'
                : 'bg-white text-gray-700 border-gray-300 hover:border-[#1F7A4C]'
            }`}
          >
            6-Month Forecast
          </button>
          <button
            onClick={() => setViewMode('timeline')}
            className={`px-4 py-2 rounded-lg border transition-colors ${
              viewMode === 'timeline'
                ? 'bg-[#1F7A4C] text-white border-[#1F7A4C]'
                : 'bg-white text-gray-700 border-gray-300 hover:border-[#1F7A4C]'
            }`}
          >
            Regrowth Timeline
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Filter by Farm
              </label>
              <select
                value={selectedFarm || ''}
                onChange={(e) => setSelectedFarm(e.target.value || null)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1F7A4C]"
              >
                <option value="">All Farms</option>
                {farms.map((farm) => (
                  <option key={farm} value={farm}>
                    {farm}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Filter by Grass Type
              </label>
              <select
                value={selectedGrass || ''}
                onChange={(e) => setSelectedGrass(e.target.value || null)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1F7A4C]"
              >
                <option value="">All Grass Types</option>
                {grassTypes.map((grass) => (
                  <option key={grass} value={grass}>
                    {grass}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Current Inventory View */}
        {viewMode === 'current' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Available by Grass Type */}
            <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Available Inventory by Grass Type
              </h2>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={grassTypes.map((grass) => {
                    const available = filteredHistory
                      .filter((h) => h.grassType === grass && h.isReady)
                      .reduce((sum, h) => sum + h.quantity, 0);
                    return { grass, available };
                  })}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="grass" tick={{ fontSize: 11 }} angle={-45} textAnchor="end" height={80} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value: number) => `${value.toLocaleString()} sq. ft.`}
                    contentStyle={{
                      backgroundColor: 'white',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                    }}
                  />
                  <Bar dataKey="available" radius={[8, 8, 0, 0]}>
                    {grassTypes.map((grass, index) => (
                      <Cell key={`cell-${index}`} fill={GRASS_COLORS[grass]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Growing Inventory */}
            <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Growing Inventory (In Regrowth)
              </h2>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={grassTypes.map((grass) => {
                    const growing = filteredHistory
                      .filter((h) => h.grassType === grass && !h.isReady)
                      .reduce((sum, h) => sum + h.quantity, 0);
                    return { grass, growing };
                  })}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="grass" tick={{ fontSize: 11 }} angle={-45} textAnchor="end" height={80} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value: number) => `${value.toLocaleString()} sq. ft.`}
                    contentStyle={{
                      backgroundColor: 'white',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                    }}
                  />
                  <Bar dataKey="growing" fill="#FFA500" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Inventory by Farm */}
            <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm lg:col-span-2">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Current Inventory by Farm
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {farms.map((farm) => {
                  const farmData = inventory[farm];
                  const total = Object.values(farmData).reduce(
                    (sum: number, qty: any) => sum + qty,
                    0
                  ) as number;

                  return (
                    <div
                      key={farm}
                      className="border border-gray-200 rounded-lg p-4 hover:border-[#1F7A4C] transition-colors"
                    >
                      <h3 className="font-medium text-gray-900 mb-3">{farm}</h3>
                      <div className="text-2xl font-semibold text-[#1F7A4C] mb-3">
                        {(total / 1000).toFixed(0)}K
                      </div>
                      <div className="space-y-2 text-xs">
                        {grassTypes.map((grass) => (
                          <div key={grass} className="flex justify-between">
                            <span className="text-gray-600">{grass}:</span>
                            <span className="font-medium text-gray-900">
                              {((farmData[grass] || 0) / 1000).toFixed(1)}K
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Forecast View */}
        {viewMode === 'forecast' && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                6-Month Availability Forecast
              </h2>
              <ResponsiveContainer width="100%" height={400}>
                <AreaChart data={forecast}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value: number) => `${value.toLocaleString()} sq. ft.`}
                    contentStyle={{
                      backgroundColor: 'white',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  {grassTypes.map((grass) => (
                    <Area
                      key={grass}
                      type="monotone"
                      dataKey={grass}
                      stackId="1"
                      stroke={GRASS_COLORS[grass]}
                      fill={GRASS_COLORS[grass]}
                      fillOpacity={0.6}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Forecast Details */}
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Monthly Forecast Details</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                        Month
                      </th>
                      {grassTypes.map((grass) => (
                        <th
                          key={grass}
                          className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase"
                        >
                          {grass}
                        </th>
                      ))}
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {forecast.map((row) => {
                      const total = grassTypes.reduce((sum, grass) => sum + (row[grass] || 0), 0);
                      return (
                        <tr key={row.date} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">
                            {row.month}
                          </td>
                          {grassTypes.map((grass) => (
                            <td key={grass} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {((row[grass] || 0) / 1000).toFixed(1)}K
                            </td>
                          ))}
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {(total / 1000).toFixed(1)}K
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Timeline View */}
        {viewMode === 'timeline' && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Upcoming Availability Timeline
              </h2>
              <p className="text-sm text-gray-600 mb-6">
                Fields grouped by week until ready for harvest
              </p>

              <div className="space-y-4">
                {timeline.slice(0, 12).map((week: any, index) => (
                  <div
                    key={index}
                    className="border border-gray-200 rounded-lg p-4 hover:border-[#1F7A4C] transition-colors"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Clock className="w-5 h-5 text-blue-600" />
                        <span className="font-medium text-gray-900">
                          Week {Math.floor(week.weekStart / 7) + 1}
                        </span>
                        <span className="text-sm text-gray-600">
                          ({week.weekStart}-{week.weekEnd} days)
                        </span>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-gray-600">Total Available</div>
                        <div className="text-lg font-semibold text-[#1F7A4C]">
                          {(week.totalQuantity / 1000).toFixed(1)}K sq. ft.
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {week.harvests.map((harvest: any) => (
                        <div
                          key={harvest.id}
                          className="bg-gray-50 rounded-lg p-3 text-sm"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-gray-900">{harvest.id}</span>
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-medium ${
                                harvest.harvestType === 'sod'
                                  ? 'bg-blue-100 text-blue-700'
                                  : 'bg-green-100 text-green-700'
                              }`}
                            >
                              {harvest.harvestType.toUpperCase()}
                            </span>
                          </div>
                          <div className="space-y-1 text-xs text-gray-600">
                            <div>{harvest.grassType}</div>
                            <div>{harvest.farm}</div>
                            <div className="font-medium text-gray-900">
                              {harvest.quantity.toLocaleString()} sq. ft.
                            </div>
                            <div className="text-blue-600">
                              Ready in {harvest.daysUntilReady} days
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Harvest History */}
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Recent Harvest History</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                        ID
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                        Farm
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                        Grass Type
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                        Type
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                        Harvested
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                        Ready Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                        Quantity
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredHistory.slice(0, 15).map((harvest) => (
                      <tr key={harvest.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {harvest.id}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {harvest.farm}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {harvest.grassType}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium ${
                              harvest.harvestType === 'sod'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-green-100 text-green-700'
                            }`}
                          >
                            {harvest.harvestType.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {new Date(harvest.harvestDate).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {new Date(harvest.readyDate).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {harvest.quantity.toLocaleString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {harvest.isReady ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              <CheckCircle className="w-3 h-3" />
                              Ready
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                              <Clock className="w-3 h-3" />
                              {harvest.daysUntilReady}d
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
