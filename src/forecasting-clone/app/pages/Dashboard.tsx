import { DashboardLayout } from '../components/DashboardLayout';
import { TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';

const mockData = {
  kpis: {
    projects: 26,
    outstanding: 37,
    delivered: 248650,
  },
  recentHarvests: [
    { id: 1, project: 'Pebble Beach Renovation', farm: 'North Farm', grass: 'Bermuda 419', qty: 12500, status: 'Delivered' },
    { id: 2, project: 'Augusta National', farm: 'South Farm', grass: 'Tifway 419', qty: 8200, status: 'In Transit' },
    { id: 3, project: 'Pinehurst No. 2', farm: 'East Farm', grass: 'SeaDwarf', qty: 15600, status: 'Pending' },
    { id: 4, project: 'St. Andrews Links', farm: 'West Farm', grass: 'Zeon Zoysia', qty: 9800, status: 'Delivered' },
    { id: 5, project: 'Oakmont CC', farm: 'North Farm', grass: 'Bermuda 419', qty: 11200, status: 'In Transit' },
  ],
};

export function Dashboard() {
  return (
    <DashboardLayout>
      <div className="p-4 lg:p-8">
        <h1 className="text-2xl lg:text-3xl font-semibold text-gray-900 mb-6">Operations Dashboard</h1>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-white p-6 rounded-lg border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Active Projects</span>
              <TrendingUp className="w-5 h-5 text-green-600" />
            </div>
            <div className="text-3xl font-semibold text-gray-900">{mockData.kpis.projects}</div>
            <p className="text-xs text-gray-500 mt-1">+3 from last month</p>
          </div>

          <div className="bg-white p-6 rounded-lg border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Outstanding Deliveries</span>
              <AlertCircle className="w-5 h-5 text-yellow-600" />
            </div>
            <div className="text-3xl font-semibold text-gray-900">{mockData.kpis.outstanding}</div>
            <p className="text-xs text-gray-500 mt-1">Requires attention</p>
          </div>

          <div className="bg-white p-6 rounded-lg border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Total Delivered (sq. ft.)</span>
              <TrendingDown className="w-5 h-5 text-blue-600" />
            </div>
            <div className="text-3xl font-semibold text-gray-900">
              {mockData.kpis.delivered.toLocaleString()}
            </div>
            <p className="text-xs text-gray-500 mt-1">This quarter</p>
          </div>
        </div>

        {/* Recent Harvests Table */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Recent Harvests</h2>
          </div>
          
          {/* Desktop Table */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Project
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Farm
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Grass
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Qty (sq. ft.)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {mockData.recentHarvests.map((harvest) => (
                  <tr key={harvest.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm text-gray-900">{harvest.project}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{harvest.farm}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{harvest.grass}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{harvest.qty.toLocaleString()}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                          harvest.status === 'Delivered'
                            ? 'bg-green-100 text-green-800'
                            : harvest.status === 'In Transit'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}
                      >
                        {harvest.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="lg:hidden divide-y divide-gray-200">
            {mockData.recentHarvests.map((harvest) => (
              <div key={harvest.id} className="p-4">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-medium text-gray-900">{harvest.project}</h3>
                  <span
                    className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                      harvest.status === 'Delivered'
                        ? 'bg-green-100 text-green-800'
                        : harvest.status === 'In Transit'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {harvest.status}
                  </span>
                </div>
                <div className="space-y-1 text-sm text-gray-600">
                  <div className="flex justify-between">
                    <span>Farm:</span>
                    <span className="text-gray-900">{harvest.farm}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Grass:</span>
                    <span className="text-gray-900">{harvest.grass}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Quantity:</span>
                    <span className="text-gray-900">{harvest.qty.toLocaleString()} sq. ft.</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
