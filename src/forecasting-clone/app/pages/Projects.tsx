import { DashboardLayout } from '../components/DashboardLayout';
import { Search, Plus } from 'lucide-react';
import { useNavigate } from 'react-router';

const mockProjects = [
  {
    id: 1,
    name: 'Pebble Beach Renovation',
    golfClub: 'Pebble Beach Golf Links',
    country: 'USA',
    holes: 18,
    type: 'Renovation',
    completion: 75,
    required: 125000,
    delivered: 93750,
  },
  {
    id: 2,
    name: 'Augusta National',
    golfClub: 'Augusta National Golf Club',
    country: 'USA',
    holes: 18,
    type: 'Maintenance',
    completion: 45,
    required: 85000,
    delivered: 38250,
  },
  {
    id: 3,
    name: 'Pinehurst No. 2',
    golfClub: 'Pinehurst Resort',
    country: 'USA',
    holes: 18,
    type: 'Restoration',
    completion: 90,
    required: 110000,
    delivered: 99000,
  },
  {
    id: 4,
    name: 'St. Andrews Links',
    golfClub: 'St. Andrews',
    country: 'Scotland',
    holes: 18,
    type: 'Renovation',
    completion: 60,
    required: 95000,
    delivered: 57000,
  },
  {
    id: 5,
    name: 'Oakmont CC',
    golfClub: 'Oakmont Country Club',
    country: 'USA',
    holes: 18,
    type: 'New Construction',
    completion: 30,
    required: 150000,
    delivered: 45000,
  },
  {
    id: 6,
    name: 'Shinnecock Hills',
    golfClub: 'Shinnecock Hills Golf Club',
    country: 'USA',
    holes: 18,
    type: 'Renovation',
    completion: 85,
    required: 105000,
    delivered: 89250,
  },
];

export function Projects() {
  const navigate = useNavigate();

  return (
    <DashboardLayout>
      <div className="p-4 lg:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
          <h1 className="text-2xl lg:text-3xl font-semibold text-gray-900">Projects</h1>
          <button
            onClick={() => navigate('/project/new')}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-[#1F7A4C] text-white rounded-lg hover:bg-[#196A40] transition-colors"
          >
            <Plus className="w-5 h-5" />
            New Project
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search projects..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
              />
            </div>
            <select className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent">
              <option value="">All Countries</option>
              <option value="USA">USA</option>
              <option value="Scotland">Scotland</option>
              <option value="UK">United Kingdom</option>
              <option value="Ireland">Ireland</option>
            </select>
            <select className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent">
              <option value="">All Types</option>
              <option value="New Construction">New Construction</option>
              <option value="Renovation">Renovation</option>
              <option value="Restoration">Restoration</option>
              <option value="Maintenance">Maintenance</option>
            </select>
          </div>
        </div>

        {/* Projects Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {mockProjects.map((project) => (
            <div
              key={project.id}
              className="bg-white rounded-lg border border-gray-200 p-6 hover:border-[#1F7A4C] transition-colors cursor-pointer"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">{project.name}</h3>
                  <p className="text-sm text-gray-600">{project.golfClub}</p>
                </div>
                <span className="px-3 py-1 bg-gray-100 text-gray-700 text-xs font-medium rounded-full">
                  {project.type}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
                <div>
                  <span className="text-gray-600">Country:</span>
                  <div className="text-gray-900 font-medium">{project.country}</div>
                </div>
                <div>
                  <span className="text-gray-600">Holes:</span>
                  <div className="text-gray-900 font-medium">{project.holes}</div>
                </div>
                <div>
                  <span className="text-gray-600">Required:</span>
                  <div className="text-gray-900 font-medium">{project.required.toLocaleString()} sq. ft.</div>
                </div>
                <div>
                  <span className="text-gray-600">Delivered:</span>
                  <div className="text-gray-900 font-medium">{project.delivered.toLocaleString()} sq. ft.</div>
                </div>
              </div>

              {/* Progress Bar */}
              <div>
                <div className="flex justify-between items-center mb-2 text-sm">
                  <span className="text-gray-600">Progress</span>
                  <span className="font-medium text-gray-900">{project.completion}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-[#1F7A4C] h-2 rounded-full transition-all"
                    style={{ width: `${project.completion}%` }}
                  />
                </div>
              </div>

              {/* Remaining */}
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-600">Remaining:</span>
                  <span className="font-medium text-gray-900">
                    {(project.required - project.delivered).toLocaleString()} sq. ft.
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
