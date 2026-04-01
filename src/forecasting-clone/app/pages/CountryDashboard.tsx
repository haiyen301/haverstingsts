import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, PieChart, Pie, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { Globe, TrendingUp, Package, DollarSign, MapPin } from 'lucide-react';
import { useHarvestingDataStore } from '@/shared/store/harvestingDataStore';

// Mock data by country
const countryData = [
  {
    country: 'USA',
    flag: '🇺🇸',
    projects: 12,
    activeHarvests: 24,
    delivered: 125000,
    revenue: 2500000,
    growth: 15,
  },
  {
    country: 'UK',
    flag: '🇬🇧',
    projects: 8,
    activeHarvests: 16,
    delivered: 85000,
    revenue: 1700000,
    growth: 12,
  },
  {
    country: 'Scotland',
    flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
    projects: 5,
    activeHarvests: 10,
    delivered: 52000,
    revenue: 1040000,
    growth: 8,
  },
  {
    country: 'Australia',
    flag: '🇦🇺',
    projects: 6,
    activeHarvests: 12,
    delivered: 64000,
    revenue: 1280000,
    growth: 18,
  },
  {
    country: 'Japan',
    flag: '🇯🇵',
    projects: 4,
    activeHarvests: 8,
    delivered: 38000,
    revenue: 760000,
    growth: 10,
  },
  {
    country: 'South Korea',
    flag: '🇰🇷',
    projects: 3,
    activeHarvests: 6,
    delivered: 28000,
    revenue: 560000,
    growth: 20,
  },
];

// Monthly trends data
const monthlyData = [
  { month: 'Oct', USA: 35000, UK: 24000, Scotland: 15000, Australia: 18000, Japan: 12000, 'South Korea': 8000 },
  { month: 'Nov', USA: 38000, UK: 26000, Scotland: 16000, Australia: 19000, Japan: 13000, 'South Korea': 9000 },
  { month: 'Dec', USA: 42000, UK: 28000, Scotland: 17000, Australia: 21000, Japan: 11000, 'South Korea': 9500 },
  { month: 'Jan', USA: 40000, UK: 27000, Scotland: 18000, Australia: 20000, Japan: 14000, 'South Korea': 10000 },
  { month: 'Feb', USA: 45000, UK: 29000, Scotland: 19000, Australia: 22000, Japan: 13500, 'South Korea': 10500 },
  { month: 'Mar', USA: 48000, UK: 31000, Scotland: 21000, Australia: 24000, Japan: 15000, 'South Korea': 11000 },
];

const COLORS = ['#1F7A4C', '#2E9B5F', '#3EBC72', '#4FDD85', '#60EE98', '#71FFAB'];

function countryCodeToFlag(code: string): string {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return '🏳️';
  return String.fromCodePoint(
    normalized.charCodeAt(0) + 127397,
    normalized.charCodeAt(1) + 127397
  );
}

export function CountryDashboard() {
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [selectedFarmId, setSelectedFarmId] = useState<string | null>(null);
  const farmsRef = useHarvestingDataStore((s) => s.farms);
  const countriesRef = useHarvestingDataStore((s) => s.countries);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore((s) => s.fetchAllHarvestingReferenceData);

  useEffect(() => {
    void fetchAllHarvestingReferenceData();
  }, [fetchAllHarvestingReferenceData]);

  const farmFilters = useMemo(() => {
    const countriesById = new Map<string, { code: string; name: string }>();
    for (const row of countriesRef) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const id = String(r.id ?? '').trim();
      if (!id) continue;
      countriesById.set(id, {
        code: String(r.country_code ?? '').trim().toUpperCase(),
        name: String(r.country_name ?? '').trim(),
      });
    }

    const out: Array<{ id: string; name: string; countryName: string; flag: string }> = [];
    for (const row of farmsRef) {
      if (!row || typeof row !== 'object') continue;
      const farm = row as Record<string, unknown>;
      if (String(farm.deleted ?? '0') === '1') continue;
      const id = String(farm.id ?? '').trim();
      const name = String(farm.name ?? '').trim();
      if (!id || !name) continue;
      const country = countriesById.get(String(farm.country_id ?? '').trim());
      out.push({
        id,
        name,
        countryName: country?.name ?? '',
        flag: countryCodeToFlag(country?.code ?? ''),
      });
    }
    return out;
  }, [farmsRef, countriesRef]);

  const totalProjects = countryData.reduce((sum, c) => sum + c.projects, 0);
  const totalDelivered = countryData.reduce((sum, c) => sum + c.delivered, 0);
  const totalRevenue = countryData.reduce((sum, c) => sum + c.revenue, 0);

  const filteredData = selectedCountry
    ? countryData.filter(c => c.country === selectedCountry)
    : countryData;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Globe className="w-8 h-8 text-[#1F7A4C]" />
              <div>
                <h1 className="text-2xl sm:text-3xl font-semibold text-gray-900">
                  Global Operations Dashboard
                </h1>
                <p className="text-sm text-gray-600 mt-1">By Country View</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Global KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Total Countries</span>
              <MapPin className="w-5 h-5 text-blue-600" />
            </div>
            <div className="text-3xl font-semibold text-gray-900">{countryData.length}</div>
            <p className="text-xs text-green-600 mt-1">Active operations</p>
          </div>

          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Total Projects</span>
              <Package className="w-5 h-5 text-purple-600" />
            </div>
            <div className="text-3xl font-semibold text-gray-900">{totalProjects}</div>
            <p className="text-xs text-green-600 mt-1">Across all regions</p>
          </div>

          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Total Delivered</span>
              <TrendingUp className="w-5 h-5 text-green-600" />
            </div>
            <div className="text-3xl font-semibold text-gray-900">
              {(totalDelivered / 1000).toFixed(0)}K
            </div>
            <p className="text-xs text-gray-500 mt-1">sq. ft. this quarter</p>
          </div>

          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Total Revenue</span>
              <DollarSign className="w-5 h-5 text-yellow-600" />
            </div>
            <div className="text-3xl font-semibold text-gray-900">
              ${(totalRevenue / 1000000).toFixed(1)}M
            </div>
            <p className="text-xs text-gray-500 mt-1">This quarter</p>
          </div>
        </div>

        {/* Country Filter */}
        <div className="mb-6">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                setSelectedCountry(null);
                setSelectedFarmId(null);
              }}
              className={`px-4 py-2 rounded-lg border transition-colors ${
                selectedCountry === null
                  ? 'bg-[#1F7A4C] text-white border-[#1F7A4C]'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-[#1F7A4C]'
              }`}
            >
              All Countries 12
            </button>
            {farmFilters.map((farm) => (
              <button
                key={farm.id}
                onClick={() => {
                  setSelectedFarmId(farm.id);
                  // Keep existing chart data as-is; filter logic can be wired later.
                  setSelectedCountry(null);
                }}
                className={`px-4 py-2 rounded-lg border transition-colors flex items-center gap-2 ${
                  selectedFarmId === farm.id
                    ? 'bg-[#1F7A4C] text-white border-[#1F7A4C]'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-[#1F7A4C]'
                }`}
              >
                <span className="text-lg">{farm.flag}</span>
                {farm.name}
              </button>
            ))}
          </div>
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Projects by Country Bar Chart */}
          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Projects by Country</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={filteredData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="country" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                  }}
                />
                <Bar dataKey="projects" fill="#1F7A4C" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Revenue Distribution Pie Chart */}
          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Revenue Distribution</h2>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={filteredData}
                  dataKey="revenue"
                  nameKey="country"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={({ country, percent }) => `${country} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {filteredData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => `$${(value / 1000).toFixed(0)}K`}
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Deliveries by Country Bar Chart */}
          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Total Delivered (sq. ft.)
            </h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={filteredData} layout="horizontal">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 12 }} />
                <YAxis dataKey="country" type="category" tick={{ fontSize: 12 }} width={80} />
                <Tooltip
                  formatter={(value: number) => `${value.toLocaleString()} sq. ft.`}
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                  }}
                />
                <Bar dataKey="delivered" fill="#2E9B5F" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Monthly Trends Line Chart */}
          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              6-Month Delivery Trends
            </h2>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlyData}>
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
                {!selectedCountry && (
                  <>
                    <Line type="monotone" dataKey="USA" stroke="#1F7A4C" strokeWidth={2} />
                    <Line type="monotone" dataKey="UK" stroke="#2E9B5F" strokeWidth={2} />
                    <Line type="monotone" dataKey="Scotland" stroke="#3EBC72" strokeWidth={2} />
                    <Line type="monotone" dataKey="Australia" stroke="#4FDD85" strokeWidth={2} />
                    <Line type="monotone" dataKey="Japan" stroke="#60EE98" strokeWidth={2} />
                    <Line type="monotone" dataKey="South Korea" stroke="#71FFAB" strokeWidth={2} />
                  </>
                )}
                {selectedCountry && (
                  <Line
                    type="monotone"
                    dataKey={selectedCountry}
                    stroke="#1F7A4C"
                    strokeWidth={3}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Country Details Table */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Country Details</h2>
          </div>
          
          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Country
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Projects
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Active Harvests
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Delivered (sq. ft.)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Revenue
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Growth
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredData.map((country) => (
                  <tr key={country.country} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{country.flag}</span>
                        <span className="text-sm font-medium text-gray-900">{country.country}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {country.projects}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {country.activeHarvests}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {country.delivered.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      ${(country.revenue / 1000).toLocaleString()}K
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        +{country.growth}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden divide-y divide-gray-200">
            {filteredData.map((country) => (
              <div key={country.country} className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-3xl">{country.flag}</span>
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900">{country.country}</h3>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 mt-1">
                      +{country.growth}% growth
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-gray-600">Projects:</span>
                    <div className="font-medium text-gray-900">{country.projects}</div>
                  </div>
                  <div>
                    <span className="text-gray-600">Harvests:</span>
                    <div className="font-medium text-gray-900">{country.activeHarvests}</div>
                  </div>
                  <div>
                    <span className="text-gray-600">Delivered:</span>
                    <div className="font-medium text-gray-900">
                      {country.delivered.toLocaleString()} sq. ft.
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-600">Revenue:</span>
                    <div className="font-medium text-gray-900">
                      ${(country.revenue / 1000).toLocaleString()}K
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
