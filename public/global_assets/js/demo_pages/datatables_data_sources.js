/* ------------------------------------------------------------------------------
 *
 *  # Datatables data sources
 *
 *  Demo JS code for datatable_data_sources.html page
 *
 * ---------------------------------------------------------------------------- */


// Setup module
// ------------------------------
let objectData = {}
let zones = {}
let detectors = []
let beaconToUser = {}
let beacons = {}
let users = {}
let usersArray = []
let presence = []
//const today = new Date().toISOString().split('T')[0]
var DatatableDataSources = function() {


    //
    // Setup module components
    //

    // Basic Datatable examples
    var _componentDatatableDataSources = function() {
        if (!$().DataTable) {
            console.warn('Warning - datatables.min.js is not loaded.');
            return;
        }

        // Setting datatable defaults
        $.extend( $.fn.dataTable.defaults, {
            autoWidth: false,
            dom: '<"datatable-header"fl><"datatable-scroll"t><"datatable-footer"ip>',
            language: {
                search: '<span>Filter:</span> _INPUT_',
                searchPlaceholder: 'Type to filter...',
                lengthMenu: '<span>Show:</span> _MENU_',
                paginate: { 'first': 'First', 'last': 'Last', 'next': $('html').attr('dir') == 'rtl' ? '&larr;' : '&rarr;', 'previous': $('html').attr('dir') == 'rtl' ? '&rarr;' : '&larr;' }
            }
        });


        // HTML sourced data
        $('.datatable-html').dataTable({
            columnDefs: [{ 
                orderable: false,
                width: 100,
                targets: [ 5 ]
            }]
        });

        // Detectors
        let datatable_door_presence = $('.datatable-presence').dataTable({
            data: presence,
            "order": [[ 0, "desc" ],[ 3, "desc"]],
            "columns": [
                {
                    data: "here",
                    render: function(data, type, row){
                        if(type === "sort" || type === "type"){
                            return data;
                        }
                        let ret = ""
                        if (data) ret = "<span class=\"badge bg-success-400\">Jelen</span>"
                        else ret = "<span class=\"badge bg-danger-400\">Elment</span>"
                        return ret
                    }
                },
                {
                    data: "key",
                    "targets": -1,
                    "width": "5%",
                    render: function(data, type, row){
                        if(type === "sort" || type === "type"){
                            return data;
                        }
                        return "<img src=\"../../../../global_assets/images/demo/users/"+beaconToUser[data].objectId+".jpg\" class=\"rounded-circle\" width=\"30\" height=\"30\" alt=\"\">"
                    }
                },
                {
                    data: "key",
                    render: function(data, type, row){
                        if(type === "sort" || type === "type"){
                            return data;
                        }
                        return beaconToUser[data].name
                    }
                },
                {
                    data: "ts",
                    render: function(data, type, row){
                        if(type === "sort" || type === "type"){
                            return data;
                        }
                        // return new Date(data).toLocaleString("hu-HU")
                        return moment(new Date(data).toLocaleString("hu-HU")).locale("hu-HU").fromNow()
                    }
                }
            ]
        });

        // AJAX sourced data
        // Door opens
        let datatable_door_opens = $('.datatable-door-opens').dataTable({
            ajax: {
                url: 'https://indoors-api.alertjack.com/v1/door-state-events?detectorId=42223:51720&access_token=PGnz3AsW6buwbzCFV8DR2gPmibp8hW',
                dataSrc: ''
            },
            "columns": [
                {
                    data: "stateCode",
                    render: function(data, type, row){
                        if(type === "sort" || type === "type"){
                            return data;
                        }
                        return "<span class=\"badge bg-success-400\">Nyit</span>"
                    }
                },
                {
                    data: "text",
                    "targets": -1,
                    "width": "5%",
                    render: function(data, type, row){
                        if(type === "sort" || type === "type"){
                            return data;
                        }
                        return "<img src=\"../../../../global_assets/images/demo/users/"+beaconToUser[data].objectId+".jpg\" class=\"rounded-circle\" width=\"30\" height=\"30\" alt=\"\">"
                    }
                },
                {
                    data: "text",
                    render: function(data, type, row){
                        if(type === "sort" || type === "type"){
                            return data;
                        }
                        return beaconToUser[data].name
                    }
                },
                {
                    data: "ts",
                    render: function(data, type, row){
                        if(type === "sort" || type === "type"){
                            return data;
                        }
                        // return new Date(data).toLocaleString("hu-HU")
                        return moment(new Date(data).toLocaleString("hu-HU")).locale("hu-HU").calendar()
                    }
                }
            ]
        });

        setInterval( function () {
            datatable_door_opens._fnAjaxUpdate( null, false ); // user paging is not reset on reload
        }, 10 * 1000 );

        setInterval( function () {
            _readPresence()
            datatable_door_presence.fnClearTable()
            //datatable_door_presence._fnDraw()
            for (i in presence) datatable_door_presence.fnAddData(presence[i], false); // Add new data
            datatable_door_presence.fnDraw()
            // datatable_door_presence.columns.adjust().draw(); // Redraw the DataTable
        }, 60 * 1000 );

        // Detectors
        $('.datatable-detectors').dataTable({
            data: detectors,
            "columns": [
                { data: "name" },
                { data: "detectorId" },
                { data: "type" },
                { data: "zone" }
            ]
        });

        // Detectors
        $('.datatable-users').dataTable({
            data: usersArray,
            "columns": [
                { data: "name" },
                { data: "objectId" },
                { data: "email" },
                {
                    data: "beaconId",
                    render: function(data, type, row){
                        if(type === "sort" || type === "type" || !data){
                            return data;
                        }
                        return ( beacons[data].beaconId || "" )
                    }

                }
            ]
        });


        //
        // Javascript sourced data
        //

        // Data
        var dataSet = [
            ['Trident','Internet Explorer 4.0','Win 95+','4','X'],
            ['Trident','Internet Explorer 5.0','Win 95+','5','C'],
            ['Trident','Internet Explorer 5.5','Win 95+','5.5','A'],
            ['Trident','Internet Explorer 6','Win 98+','6','A'],
            ['Gecko','Firefox 1.0','Win 98+ / OSX.2+','1.7','A'],
            ['Gecko','Firefox 1.5','Win 98+ / OSX.2+','1.8','A'],
            ['Gecko','Firefox 2.0','Win 98+ / OSX.2+','1.8','A'],
            ['Gecko','Firefox 3.0','Win 2k+ / OSX.3+','1.9','A'],
            ['Gecko','Camino 1.0','OSX.2+','1.8','A'],
            ['Gecko','Camino 1.5','OSX.3+','1.8','A'],
            ['Webkit','Safari 1.2','OSX.3','125.5','A'],
            ['Webkit','Safari 1.3','OSX.3','312.8','A'],
            ['Webkit','Safari 2.0','OSX.4+','419.3','A'],
            ['Presto','Opera 7.0','Win 95+ / OSX.1+','-','A'],
            ['Presto','Opera 7.5','Win 95+ / OSX.2+','-','A'],
            ['Misc','NetFront 3.1','Embedded devices','-','C'],
            ['Misc','NetFront 3.4','Embedded devices','-','A'],
            ['Misc','Dillo 0.8','Embedded devices','-','X'],
            ['Misc','Links','Text only','-','X']
        ];

        // Initialize
        $('.datatable-js').dataTable({
            data: dataSet,
            columnDefs: []
        });


        //
        // Nested object data
        //

        $('.datatable-nested').dataTable({
            ajax: '../../../../global_assets/demo_data/tables/datatable_nested.json',
            columns: [
                {data: "name[, ]"},
                {data: "hr.0" },
                {data: "office"},
                {data: "extn"},
                {data: "hr.2"},
                {data: "hr.1"}
            ]
        });


        //
        // Generate content for a column
        //

        // Table config
        var table = $('.datatable-generated').DataTable({
            ajax: '../../../../global_assets/demo_data/tables/datatable_ajax.json',
            columnDefs: [{
                targets: 2,
                data: null,
                defaultContent: "<a class='badge badge-secondary text-white cursor-pointer'>Show</a>"
            },
            { 
                orderable: false,
                targets: [0, 2]
            }]
        });
        
        // Location alert
        $('.datatable-generated tbody').on('click', 'a', function () {
            var data = table.row($(this).parents('tr')).data();
            alert(data[0] +"'s location is: "+ data[ 2 ]);
        });
    };

    // Select2 for length menu styling
    var _componentSelect2 = function() {
        if (!$().select2) {
            console.warn('Warning - select2.min.js is not loaded.');
            return;
        }

        // Initialize
        $('.dataTables_length select').select2({
            minimumResultsForSearch: Infinity,
            dropdownAutoWidth: true,
            width: 'auto'
        });
    };

    var _readPresence = function() {
        $.ajax({
            dataType: "json",
            url: 'https://indoors-api.alertjack.com/v1/beacon-adv-best-detector-door-zone/all/calendar/?membersOnly=true&storeId=1&access_token=PGnz3AsW6buwbzCFV8DR2gPmibp8hW',
            async: false,
            success: function (data) {
                presence = []
                let lastDay = "1900-01-01"
                const currentTs = moment().unix() * 1000
                const todayDATE = moment().format()
                const today = todayDATE.split('T')[0]
                const hhmm = todayDATE.split('T')[1].substring(0,5)
                Object.keys(data).forEach(function (key) {
                    Object.keys(data[key]).forEach(function (day) {
                        lastDay = day
                    })
                    if (lastDay == today && data[key][lastDay]) {
                        const lastTime = data[key][lastDay][0][data[key][lastDay][0].length - 1].substring(7,12)
                        const ts = moment(lastDay + " " + lastTime, "YYYY-MM-DD hh:mm").valueOf()
                        const here = (ts > currentTs - 3 * 60 * 1000)
                        //console.log(here, lastTime, key, ts, currentTs)
                        presence.push({here, lastTime, key, ts, currentTs})
                    }
                })
            }
        })
    }


    var _readObjects = function() {
        $.ajax({
            dataType: "json",
            url: 'https://indoors-api.alertjack.com/v1/demo-ui/data?storeId=1&access_token=PGnz3AsW6buwbzCFV8DR2gPmibp8hW',
            async: false,
            success: function(data) {
                objectData = data
                Object.keys(data.zoneMap).forEach(function (key) {
                    data.zoneMap[key].detectors.map(e => {zones[e] = data.zoneMap[key].name })
                })
                Object.keys(data.detectorMap).forEach(function (key) {
                    const detector = data.detectorMap[key]
                    detector.zone = ( zones[key] || "" )
                    detectors.push(detector)
                })
                Object.keys(data.userMap).forEach(function (key) {
                    users[data.userMap[key].objectId] = data.userMap[key]
                    const user = data.userMap[key]
                    user.beaconId = ( user.beaconId || "" )
                    user.email = ( user.email || "" )
                    usersArray.push(data.userMap[key])
                })
                Object.keys(data.beaconMap).forEach(function (key) {
                    beaconToUser[data.beaconMap[key].beaconId] = users[data.beaconMap[key].userId]
                    beacons[data.beaconMap[key].objectId] = data.beaconMap[key]
                })
            }
        });
    };

    //
    // Return objects assigned to module
    //

    return {
        init: function() {
            _readObjects()
            _readPresence()
            _componentDatatableDataSources();
            _componentSelect2();
        }
    }
}();


// Initialize module
// ------------------------------

document.addEventListener('DOMContentLoaded', function() {
    DatatableDataSources.init();
});
