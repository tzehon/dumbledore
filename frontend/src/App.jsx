// File: frontend/src/App.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';

const API_BASE_URL = 'http://localhost:5001/api';

// --- Main App Component ---
export default function App() {
  const [communications, setCommunications] = useState([]);
  const [isLoadingComms, setIsLoadingComms] = useState(false);
  const [view, setView] = useState('dashboard'); // 'dashboard' or 'campaign'

  // Clear request timings when switching views
  const handleViewChange = (newView) => {
    setRequestTimings({});
    setView(newView);
  };
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [error, setError] = useState(null);
  const [lookupUserId, setLookupUserId] = useState('1001'); // The value in the input box
  const [searchedUserId, setSearchedUserId] = useState(''); // The ID that has been searched for
  const [queryDuration, setQueryDuration] = useState(null);
  
  // Track timing for all API requests
  const [requestTimings, setRequestTimings] = useState({});

  const [templates, setTemplates] = useState([]);
  const [trackingIds, setTrackingIds] = useState([]);
  const [isLoadingDropdowns, setIsLoadingDropdowns] = useState(true);

  const initialLoadDone = useRef(false);

  // Helper function to track API request timing
  const trackApiCall = (requestKey, type, description, clearPrevious = false) => {
    // Only clear previous timings if explicitly requested (for user-initiated actions)
    if (clearPrevious) {
      setRequestTimings({});
    }
    
    const startTime = performance.now();
    
    const finishTracking = (success = true) => {
      const endTime = performance.now();
      const duration = Math.round(endTime - startTime);
      
      setRequestTimings(prev => ({
        ...prev,
        [requestKey]: {
          duration,
          type, // 'read' or 'write'
          description,
          timestamp: new Date().toISOString(),
          success
        }
      }));
      
      return duration;
    };
    
    return { finishTracking };
  };

  // Fetch communications when a searched user or date changes
  const fetchCommunications = useCallback((userId, date, clearPrevious = false) => {
    if (!userId) return;
    setIsLoadingComms(true);
    setError(null);
    setQueryDuration(null);

    const requestKey = `fetch-comms-${userId}-${date}`;
    const { finishTracking } = trackApiCall(requestKey, 'read', `Fetch communications for user ${userId} on ${date}`, clearPrevious);

    const startOfDay = new Date(date);
    startOfDay.setUTCHours(0,0,0,0);
    const query = { "user.id": parseInt(userId), day: startOfDay };
    console.log("--- Frontend Query Log (Req B & E) ---");
    console.log("db.collection('communications').findOne(", JSON.stringify(query, null, 2), ")");

    fetch(`${API_BASE_URL}/communications/user/${userId}?date=${date}`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
      })
      .then(data => {
        setCommunications(data);
        const duration = finishTracking(true);
        setQueryDuration(duration);
      })
      .catch(error => {
        console.error("Fetch communications error:", error);
        setError("Failed to fetch communications. Please check the server connection or user ID.");
        finishTracking(false);
      })
      .finally(() => {
        setIsLoadingComms(false);
      });
  }, []);

  useEffect(() => {
    if (initialLoadDone.current) {
        return;
    }
    initialLoadDone.current = true;

    setSearchedUserId('1001');

    setIsLoadingDropdowns(true);
    
    const templatesKey = 'fetch-templates';
    const trackingIdsKey = 'fetch-tracking-ids';
    const { finishTracking: finishTemplatesTracking } = trackApiCall(templatesKey, 'read', 'Fetch templates');
    const { finishTracking: finishTrackingIdsTracking } = trackApiCall(trackingIdsKey, 'read', 'Fetch tracking IDs');
    
    const fetchTemplates = fetch(`${API_BASE_URL}/templates`)
      .then(res => res.json())
      .then(data => {
        finishTemplatesTracking(true);
        return data;
      })
      .catch(err => {
        finishTemplatesTracking(false);
        throw err;
      });
    
    const fetchTrackingIds = fetch(`${API_BASE_URL}/tracking-ids`)
      .then(res => res.json())
      .then(data => {
        finishTrackingIdsTracking(true);
        return data;
      })
      .catch(err => {
        finishTrackingIdsTracking(false);
        throw err;
      });

    Promise.all([fetchTemplates, fetchTrackingIds])
        .then(([templateData, trackingIdData]) => {
            setTemplates(templateData);
            setTrackingIds(trackingIdData);
        })
        .catch(err => {
            console.error("Fetch dropdowns error:", err);
            setError("Failed to load campaign data.");
        })
        .finally(() => {
            setIsLoadingDropdowns(false);
        });
  }, []);

  useEffect(() => {
    if (!initialLoadDone.current) return;

    if (searchedUserId) {
        fetchCommunications(searchedUserId, selectedDate, true);
    }
  }, [searchedUserId, selectedDate, fetchCommunications]);


  const handleDateChange = (e) => {
    const newDate = e.target.value;
    setSelectedDate(newDate);
  }

  const handleSearch = () => {
    if (lookupUserId === searchedUserId) {
        fetchCommunications(lookupUserId, selectedDate, true);
    } else {
        setSearchedUserId(lookupUserId);
    }
  }

  const handleUpdateStatus = (comm, newStatus) => {
    setError(null);
    const payload = {
      userId: parseInt(searchedUserId),
      dispatch_time: comm.dispatch_time,
      templateId: comm.metadata.template_id,
      trackingId: comm.metadata.tracking_id,
      newStatus: newStatus
    };

    const requestKey = `update-status-${comm.metadata.tracking_id}-${Date.now()}`;
    const { finishTracking } = trackApiCall(requestKey, 'write', `Update status to ${newStatus} for tracking ID ${comm.metadata.tracking_id}`, true);

    fetch(`${API_BASE_URL}/communications/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
    })
    .then(() => {
        finishTracking(true);
        fetchCommunications(searchedUserId, selectedDate, false); // Refresh data without clearing timings
    })
    .catch(err => {
        console.error("Update status error:", err);
        setError("Failed to update status. Please try again.");
        finishTracking(false);
    });
  };

  const handleSendNewComm = (count) => {
    if (!searchedUserId || count < 1) return;
    setError(null);
    const templateId = `template_${String(Math.floor(Math.random() * 20) + 1).padStart(3, '0')}`;
    const trackingId = `track_${String(Math.floor(Math.random() * 10) + 1).padStart(3, '0')}`;
    const userType = Math.random() > 0.5 ? 'premium' : 'standard'; // Assume we get this from somewhere

    const requestKey = `send-comms-${searchedUserId}-${Date.now()}`;
    const { finishTracking } = trackApiCall(requestKey, 'write', `Append ${count} communications for user ${searchedUserId}`, true);

    fetch(`${API_BASE_URL}/communications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: parseInt(searchedUserId), userType, templateId, trackingId, count: parseInt(count) })
    })
    .then(async res => {
        if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.message || `HTTP error! status: ${res.status}`);
        }
        return res.json();
    })
    .then(() => {
        finishTracking(true);
        const today = new Date().toISOString().split('T')[0];
        if (selectedDate === today) {
            fetchCommunications(searchedUserId, selectedDate, false); // Refresh data without clearing timings
        } else {
            alert(`${count} new communication(s) sent for today.`);
        }
    })
    .catch(err => {
        console.error("Send new comm error:", err);
        setError(err.message);
        finishTracking(false);
    });
  };

  const handleReplaceComms = () => {
    if (!searchedUserId) return;
    setError(null);

    const now = new Date();
    const mockNewComms = [
        {
            dispatch_time: new Date(now.getTime() - 1000), // Ensure slightly different timestamps
            metadata: { tracking_id: "REPLACED-01", template_id: "REPLACE-TPL" },
            content_score: 1.0,
            status: "replaced"
        },
        {
            dispatch_time: now,
            metadata: { tracking_id: "REPLACED-02", template_id: "REPLACE-TPL" },
            content_score: 1.0,
            status: "replaced"
        }
    ];

    const requestKey = `replace-comms-${searchedUserId}-${selectedDate}-${Date.now()}`;
    const { finishTracking } = trackApiCall(requestKey, 'write', `Replace communications for user ${searchedUserId} on ${selectedDate}`, true);

    fetch(`${API_BASE_URL}/communications/replace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            userId: parseInt(searchedUserId),
            date: selectedDate,
            communications: mockNewComms
        })
    })
    .then(res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
    })
    .then(() => {
        finishTracking(true);
        alert(`Communications for ${selectedDate} have been replaced.`);
        fetchCommunications(searchedUserId, selectedDate, false); // Refresh data without clearing timings
    })
    .catch(err => {
        console.error("Replace comms error:", err);
        setError("Failed to replace communications. Please try again.");
        finishTracking(false);
    });
  };

  return (
    <div className="bg-gray-50 min-h-screen font-sans">
      <Header setView={handleViewChange} currentView={view} />
      <main className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
        {error && <ErrorMessage message={error} />}
        {view === 'dashboard' ? (
          <Dashboard
            communications={communications}
            isLoadingComms={isLoadingComms}
            onUpdateStatus={handleUpdateStatus}
            onSendNewComm={handleSendNewComm}
            onReplaceComms={handleReplaceComms}
            selectedDate={selectedDate}
            onDateChange={handleDateChange}
            lookupUserId={lookupUserId}
            setLookupUserId={setLookupUserId}
            onSearch={handleSearch}
            queryDuration={queryDuration}
            requestTimings={requestTimings}
          />
        ) : (
          <CampaignView
            templates={templates}
            trackingIds={trackingIds}
            isLoadingDropdowns={isLoadingDropdowns}
            requestTimings={requestTimings}
          />
        )}
      </main>
    </div>
  );
}

// --- UI Components ---

function Tooltip({ text }) {
    return (
        <div className="relative flex items-center group">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            <div className="absolute bottom-full mb-2 w-64 bg-gray-900 text-white text-xs rounded py-2 px-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
                {text}
            </div>
        </div>
    );
}

function ErrorMessage({ message }) {
    return (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg relative mb-6" role="alert">
            <strong className="font-bold">Error: </strong>
            <span className="block sm:inline">{message}</span>
        </div>
    );
}

function Header({ setView, currentView }) {
  return (
    <header className="bg-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <h1 className="text-2xl font-bold text-gray-800">🧙 Dumbledore - SmartComms</h1>
        </div>
        <nav className="flex space-x-2 bg-gray-200 p-1 rounded-lg">
          <button onClick={() => setView('dashboard')} className={`px-4 py-1.5 text-sm font-medium rounded-md ${currentView === 'dashboard' ? 'bg-white text-gray-700 shadow' : 'text-gray-600 hover:bg-gray-300'}`}>User Lookup</button>
          <button onClick={() => setView('campaign')} className={`px-4 py-1.5 text-sm font-medium rounded-md ${currentView === 'campaign' ? 'bg-white text-gray-700 shadow' : 'text-gray-600 hover:bg-gray-300'}`}>Campaign Tool</button>
        </nav>
      </div>
    </header>
  );
}

function Dashboard({ communications, isLoadingComms, onUpdateStatus, onSendNewComm, onReplaceComms, selectedDate, onDateChange, lookupUserId, setLookupUserId, onSearch, queryDuration, requestTimings }) {
  return (
    <div>
      <UserLookup
        lookupUserId={lookupUserId}
        setLookupUserId={setLookupUserId}
        onSendNewComm={onSendNewComm}
        onSearch={onSearch}
        requestTimings={requestTimings}
      />
      <CommunicationsLog
          communications={communications}
          isLoading={isLoadingComms}
          onUpdateStatus={onUpdateStatus}
          onReplaceComms={onReplaceComms}
          selectedDate={selectedDate}
          onDateChange={onDateChange}
          queryDuration={queryDuration}
          requestTimings={requestTimings}
      />
      <RequestTimingsDisplay requestTimings={requestTimings} />
    </div>
  );
}

function UserLookup({ lookupUserId, setLookupUserId, onSendNewComm, onSearch, requestTimings }) {
    const [count, setCount] = useState(1);

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            onSearch();
        }
    }

    return (
        <div className="bg-white p-6 rounded-lg shadow mb-6">
        <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
                <label htmlFor="userIdInput" className="text-lg font-semibold text-gray-700">User ID Lookup (Req B & E - Read):</label>
                <input
                    id="userIdInput"
                    type="number"
                    value={lookupUserId}
                    onChange={(e) => setLookupUserId(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="p-2 border border-gray-300 rounded-md shadow-sm w-48"
                />
                <button onClick={onSearch} className="bg-gray-800 text-white px-4 py-2 rounded-lg font-semibold hover:bg-gray-900 transition-colors shadow">
                    Search
                </button>
            </div>
            <div className="flex items-center gap-2">
                <input
                    type="number"
                    value={count}
                    onChange={(e) => setCount(e.target.value)}
                    className="p-2 border border-gray-300 rounded-md shadow-sm w-20 text-center"
                    min="1"
                />
                <button onClick={() => onSendNewComm(count)} className="bg-green-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-green-700 transition-colors shadow">
                    Append Comm(s) (Req A - Write)
                </button>
                <Tooltip text="Appends the specified number of new, random communications for the current user for today." />
            </div>
        </div>
        </div>
    );
}

function CommunicationsLog({ communications, isLoading, onUpdateStatus, onReplaceComms, selectedDate, onDateChange, queryDuration, requestTimings }) {
  return (
    <div className="bg-white p-4 rounded-lg shadow">
      <div className="flex justify-between items-center mb-4 border-b pb-2">
        <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-gray-700">Communications Log</h3>
        </div>
        <div className="flex items-center gap-4">
          <input type="date" value={selectedDate} onChange={onDateChange} className="p-1 border border-gray-300 rounded-md shadow-sm"/>
          <div className="flex items-center gap-2">
            <button onClick={onReplaceComms} className="bg-amber-500 text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-amber-600 transition-colors shadow">
                Replace Today's Comms (Req C - Write)
            </button>
            <Tooltip text="Replaces all communications for the selected date with two mock 'REPLACED' events." />
          </div>
        </div>
      </div>
      <div className="space-y-3">
        {isLoading ? <p className="text-gray-500 text-center p-4">Loading...</p> :
          communications.length === 0 ? <p className="text-gray-500 text-center p-4">No communications found for this date.</p> :
            communications.map(comm => (
              <div key={comm.dispatch_time + comm.metadata.tracking_id} className="bg-gray-50 p-4 rounded-lg flex justify-between items-center">
                <div>
                  <p className="font-semibold text-gray-800">Template: {comm.metadata.template_id}</p>
                  <p className="text-sm text-gray-500">At: {new Date(comm.dispatch_time).toLocaleTimeString()} | Tracking ID: {comm.metadata.tracking_id}</p>
                </div>
                <div className="flex items-center space-x-2">
                    <span className={`px-2 py-1 text-xs font-bold rounded-full ${comm.status === 'sent' ? 'bg-blue-100 text-blue-800' : comm.status === 'opened' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>{comm.status}</span>
                    {comm.status === 'sent' && (
                        <button onClick={() => onUpdateStatus(comm, 'opened')} className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold py-1 px-2 rounded-md">Mark as Opened (Req F - Write)</button>
                    )}
                </div>
              </div>
            ))
        }
      </div>
    </div>
  );
}

function CampaignView({ templates, trackingIds, isLoadingDropdowns, requestTimings }) {
    const [params, setParams] = useState({
        date: new Date().toISOString().split('T')[0],
        hour: new Date().getHours(),
        templateId: '',
        trackingId: ''
    });
    const [distinctUsers, setDistinctUsers] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [campaignQueryDuration, setCampaignQueryDuration] = useState(null);
    // --- CHANGE: New state for pagination ---
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(0);
    const [totalUsers, setTotalUsers] = useState(0);
    const [campaignTimings, setCampaignTimings] = useState({});

    // Helper function to track API request timing for campaign
    const trackCampaignApiCall = (requestKey, type, description, clearPrevious = true) => {
        // Clear all previous campaign timings when starting a new user action
        if (clearPrevious) {
            setCampaignTimings({});
        }
        
        const startTime = performance.now();
        
        const finishTracking = (success = true) => {
            const endTime = performance.now();
            const duration = Math.round(endTime - startTime);
            
            setCampaignTimings(prev => ({
                ...prev,
                [requestKey]: {
                    duration,
                    type, // 'read' or 'write'
                    description,
                    timestamp: new Date().toISOString(),
                    success
                }
            }));
            
            return duration;
        };
        
        return { finishTracking };
    };

    // Set initial params once dropdown data is available
    useEffect(() => {
        if (!isLoadingDropdowns) {
            setParams(p => ({
                ...p,
                templateId: templates[0] || '',
                trackingId: trackingIds[0] || ''
            }));
        }
    }, [isLoadingDropdowns, templates, trackingIds]);

    const handleSearch = useCallback((newPage = 1) => {
        setIsLoading(true);
        setCampaignQueryDuration(null);
        setError(null);

        const requestKey = `campaign-search-${params.date}-${params.hour}-${params.templateId}-${params.trackingId}-page${newPage}`;
        const { finishTracking } = trackCampaignApiCall(requestKey, 'read', `Campaign search for ${params.templateId} on ${params.date} hour ${params.hour}`);

        const query = { ...params, page: newPage };
        const queryString = new URLSearchParams(query).toString();

        fetch(`${API_BASE_URL}/campaigns/distinct-users?${queryString}`)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
                return res.json();
            })
            .then(data => {
                setDistinctUsers(data.data);
                setTotalUsers(data.total);
                setTotalPages(data.totalPages);
                setPage(data.page);
                const duration = finishTracking(true);
                setCampaignQueryDuration(duration);
            })
            .catch(err => {
                console.error("Campaign search error:", err);
                setError("Failed to search for campaign users.");
                setDistinctUsers([]);
                setTotalUsers(0);
                finishTracking(false);
            })
            .finally(() => {
                setIsLoading(false);
            });
    }, [params]);

    const handleFormSubmit = (e) => {
        e.preventDefault();
        setPage(1); // Reset to first page on new search
        handleSearch(1);
    }

    const handleChange = (e) => {
        setParams({...params, [e.target.name]: e.target.value});
    }

    return (
        <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Find Distinct Users for Campaign (Req D)</h2>
            {error && <ErrorMessage message={error} />}
            <form onSubmit={handleFormSubmit} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end mb-6">
                <div>
                    <label className="block text-sm font-medium text-gray-600">Date</label>
                    <input type="date" name="date" value={params.date} onChange={handleChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"/>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-600">Hour (0-23)</label>
                    <input type="number" name="hour" min="0" max="23" value={params.hour} onChange={handleChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"/>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-600">Template ID</label>
                    <select name="templateId" value={params.templateId} onChange={handleChange} disabled={isLoadingDropdowns} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 disabled:bg-gray-200">
                        {isLoadingDropdowns ? <option>Loading...</option> : templates.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-600">Tracking ID</label>
                    <select name="trackingId" value={params.trackingId} onChange={handleChange} disabled={isLoadingDropdowns} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 disabled:bg-gray-200">
                        {isLoadingDropdowns ? <option>Loading...</option> : trackingIds.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                </div>
                <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-green-700 transition-colors shadow h-10">Search</button>
            </form>
            <div>
                {isLoading && <p>Loading results...</p>}
                {totalUsers > 0 && (
                    <div>
                        <div className="flex justify-between items-center">
                            <h3 className="font-semibold text-lg">
                                Found {totalUsers.toLocaleString()} unique users (Read)
                                {campaignQueryDuration !== null && <span className="text-sm text-gray-500 ml-2">(Query took: {campaignQueryDuration}ms)</span>}
                            </h3>
                            <div className="flex items-center gap-2">
                                <button onClick={() => handleSearch(page - 1)} disabled={page <= 1} className="px-3 py-1 bg-gray-200 rounded-md disabled:opacity-50">Previous</button>
                                <span>Page {page} of {totalPages}</span>
                                <button onClick={() => handleSearch(page + 1)} disabled={page >= totalPages} className="px-3 py-1 bg-gray-200 rounded-md disabled:opacity-50">Next</button>
                            </div>
                        </div>
                        <div className="mt-2 bg-gray-100 p-4 rounded-md max-h-60 overflow-y-auto">
                            {distinctUsers.length > 0 ? distinctUsers.join(', ') : 'No users found for this criteria.'}
                        </div>
                    </div>
                )}
            </div>
            <RequestTimingsDisplay requestTimings={{...requestTimings, ...campaignTimings}} />
        </div>
    );
}

function RequestTimingsDisplay({ requestTimings }) {
    const timingEntries = Object.entries(requestTimings).sort((a, b) => 
        new Date(b[1].timestamp) - new Date(a[1].timestamp)
    );

    if (timingEntries.length === 0) {
        return null;
    }

    return (
        <div className="bg-white p-4 rounded-lg shadow mt-6">
            <h3 className="text-lg font-semibold text-gray-700 mb-4">API Request Timings</h3>
            <div className="space-y-2 max-h-60 overflow-y-auto">
                {timingEntries.slice(0, 10).map(([key, timing]) => (
                    <div key={key} className="flex justify-between items-center p-3 bg-gray-50 rounded-md">
                        <div className="flex-1">
                            <div className="flex items-center gap-2">
                                <span className={`px-2 py-1 text-xs font-bold rounded-full ${
                                    timing.type === 'read' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
                                }`}>
                                    {timing.type.toUpperCase()}
                                </span>
                                <span className={`px-2 py-1 text-xs font-bold rounded-full ${
                                    timing.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                }`}>
                                    {timing.success ? 'SUCCESS' : 'FAILED'}
                                </span>
                            </div>
                            <p className="text-sm text-gray-700 mt-1">{timing.description}</p>
                            <p className="text-xs text-gray-500">{new Date(timing.timestamp).toLocaleTimeString()}</p>
                        </div>
                        <div className="text-right">
                            <p className="font-semibold text-gray-800">{timing.duration}ms</p>
                        </div>
                    </div>
                ))}
                {timingEntries.length > 10 && (
                    <p className="text-sm text-gray-500 text-center pt-2">
                        Showing latest 10 of {timingEntries.length} requests
                    </p>
                )}
            </div>
        </div>
    );
}
