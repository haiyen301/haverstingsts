import { DashboardLayout } from '../components/DashboardLayout';
import { Search, Filter, Plus } from 'lucide-react';
import { useNavigate } from 'react-router';

const mockHarvests = [
  { id: 1, date: '2026-03-24', project: 'Pebble Beach Renovation', farm: 'North Farm', grass: 'Bermuda 419', qty: 12500, zone: 'A', status: 'Delivered' },
  { id: 2, date: '2026-03-23', project: 'Augusta National', farm: 'South Farm', grass: 'Tifway 419', qty: 8200, zone: 'B', status: 'In Transit' },
  { id: 3, date: '2026-03-22', project: 'Pinehurst No. 2', farm: 'East Farm', grass: 'SeaDwarf', qty: 15600, zone: 'C', status: 'Pending' },
  { id: 4, date: '2026-03-21', project: 'St. Andrews Links', farm: 'West Farm', grass: 'Zeon Zoysia', qty: 9800, zone: 'A', status: 'Delivered' },
  { id: 5, date: '2026-03-20', project: 'Oakmont CC', farm: 'North Farm', grass: 'Bermuda 419', qty: 11200, zone: 'B', status: 'In Transit' },
  { id: 6, date: '2026-03-19', project: 'Merion Golf Club', farm: 'South Farm', grass: 'Meyer Zoysia', qty: 7500, zone: 'D', status: 'Delivered' },
  { id: 7, date: '2026-03-18', project: 'Shinnecock Hills', farm: 'East Farm', grass: 'Tifway 419', qty: 13400, zone: 'A', status: 'Pending' },
  { id: 8, date: '2026-03-17', project: 'Cypress Point', farm: 'West Farm', grass: 'SeaDwarf', qty: 10300, zone: 'C', status: 'Delivered' },
];

export function Harvests() {
  const navigate = useNavigate();

  return (
    <DashboardLayout>
      <div className="p-4 lg:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
          <h1 className="text-2xl lg:text-3xl font-semibold text-gray-900">Harvests</h1>
          <button
            onClick={() => navigate('/harvest/new')}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-[#1F7A4C] text-white rounded-lg hover:bg-[#196A40] transition-colors"
          >
            <Plus className="w-5 h-5" />
            New Harvest
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search harvests..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
              />
            </div>
            <select className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent">
              <option value="">All Farms</option>
              <option value="North Farm">North Farm</option>
              <option value="South Farm">South Farm</option>
              <option value="East Farm">East Farm</option>
              <option value="West Farm">West Farm</option>
            </select>
            <select className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent">
              <option value="">All Status</option>
              <option value="Delivered">Delivered</option>
              <option value="In Transit">In Transit</option>
              <option value="Pending">Pending</option>
            </select>
          </div>
        </div>

        {/* Harvests Table */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {/* Desktop Table */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Date
                  </th>
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
                    Zone
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
                {mockHarvests.map((harvest) => (
                  <tr key={harvest.id} className="hover:bg-gray-50 cursor-pointer">
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {new Date(harvest.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900 font-medium">{harvest.project}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{harvest.farm}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{harvest.grass}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">Zone {harvest.zone}</td>
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
            {mockHarvests.map((harvest) => (
              <div key={harvest.id} className="p-4">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-medium text-gray-900 mb-1">{harvest.project}</h3>
                    <p className="text-sm text-gray-500">
                      {new Date(harvest.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>
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
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-gray-600">Farm:</span>
                    <div className="text-gray-900">{harvest.farm}</div>
                  </div>
                  <div>
                    <span className="text-gray-600">Zone:</span>
                    <div className="text-gray-900">Zone {harvest.zone}</div>
                  </div>
                  <div>
                    <span className="text-gray-600">Grass:</span>
                    <div className="text-gray-900">{harvest.grass}</div>
                  </div>
                  <div>
                    <span className="text-gray-600">Quantity:</span>
                    <div className="text-gray-900">{harvest.qty.toLocaleString()} sq. ft.</div>
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
