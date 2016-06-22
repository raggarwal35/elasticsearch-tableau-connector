 (function() {

  var elasticsearchTableauDataTypeMap = {
    string: 'string',
    float: 'float',
    long: 'int',
    integer: 'int',
    date: 'datetime',
    boolean: 'bool',
    geo_point: 'string'
  },
    elasticsearchFields = [],
    elasticsearchFieldsMap = {},
    elasticsearchDateFields = [],
    elasticsearchGeoPointFields = [],
    elasticsearchIndices = [],
    elasticsearchTypes = [],
    startTime,
    endTime;
  
  var addElasticsearchField = function(name, esType, format, hasLatLon){
    
      if(_.isUndefined(elasticsearchTableauDataTypeMap[esType])){
          return;
      }
                  
      elasticsearchFields.push({ name: name, dataType: elasticsearchTableauDataTypeMap[esType] });
      elasticsearchFieldsMap[name] = { type: elasticsearchTableauDataTypeMap[esType], format: format };
      
      if(esType == 'date'){
          elasticsearchDateFields.push(name);
      }
      
      if(esType == 'geo_point'){
          elasticsearchGeoPointFields.push({name: name, hasLatLon: hasLatLon});
          addElasticsearchField(name + '_latitude', 'float');
          addElasticsearchField(name + '_longitude', 'float');
      }
  }

  //RA - recursion for nested objects
  var traverseHeader = function (obj, key)
  {
    if (obj.properties !== null && obj.properties !== undefined && typeof obj.properties == 'object')
    {
       $.each(obj.properties, function(k, v) {
         var kLocal = k;
         if (key != "") kLocal = key + "." + k;
         if (_.has(obj.properties, [k, "properties"]))
         {
             traverseHeader(obj.properties[k], kLocal);
         }
         else
         {
           addElasticsearchField(kLocal, v.type, v.format, v.lat_lon);
         }
       });
    }
  };

    var getElasticsearchTypeMapping = function(connectionData){

      tableau.log('[getElasticsearchTypeMapping] invoking');

      if(!connectionData.elasticsearchUrl || !connectionData.elasticsearchIndex || !connectionData.elasticsearchType){
          return;
      }

        addElasticsearchField('_id', 'string');
        addElasticsearchField('_sequence', 'integer');

    $.ajax(connectionData.elasticsearchUrl + '/' + connectionData.elasticsearchIndex + '/' + 
           connectionData.elasticsearchType + '/_mapping', {
      context: connectionData,
      dataType: 'json',
      beforeSend: function(xhr) { 
          if(connectionData.elasticsearchAuthenticate && tableau.username){
              xhr.setRequestHeader("Authorization", "Basic " + 
                btoa(tableau.username + ":" + tableau.password));
          }

        },
      success: function(data){
              
              var connectionData = this;
              console.log('[getElasticsearchTypeMapping] ', connectionData);
        
        var indexName = connectionData.elasticsearchIndex;
        
        // Then we selected an alias... choose the last index with a matching type name
        // TODO: Let user choose which type from which index
        if(data[connectionData.elasticsearchIndex] == null){
            _.forIn(data, function(index, indexKey){
                if(index.mappings[connectionData.elasticsearchType]){
                    indexName = indexKey;
                }
            });
        }

        var key = "";
        //RA - recursion for nested objects
        traverseHeader(data[indexName].mappings[connectionData.elasticsearchType], key);

        tableau.log('Number of header columns: ' + elasticsearchFields.length);
        
        var connectionData = getTableauConnectionData();
      
        var connectionName = $('#inputConnectionName').val();
        tableau.connectionName = connectionName ? connectionName : "Elasticsearch Datasource";
        
        updateTableauConnectionData();        
      
        startTime = moment();
        $('#myPleaseWait').modal('show');
          if(tableau.phase == tableau.phaseEnum.interactivePhase || tableau.phase == tableau.phaseEnum.authPhase) {
              console.log('[getElasticsearchTypeMapping] Submitting tableau interactive phase data');
              tableau.submit();
          }
          else{
              abortWithError('Invalid phase: ' + tableau.phase + ' aborting');
          }

      },
      error: function(xhr, ajaxOptions, err){
        if(xhr.status == 0){
          abort('Request error, unable to connect to host or CORS request was denied');
        }
        else{
          abort('Request error, status code: ' + xhr.status + '; ' + xhr.responseText + '\n' + err);
        }          
      }
    }); 
  }

  function abort(errorMessage){
      
      $('#divMessage').css('display', 'none');
      
      $('#divError').css('display', 'block');
      $('#errorText').text(errorMessage);  
      
      $('html, body').animate({
        scrollTop: $("#divError").offset().top
    }, 500);
    
      tableau.log(errorMessage);
      tableau.abortWithError(errorMessage);    
  }
  
  //
  // Connector definition
  // 

  var myConnector = tableau.makeConnector();

  myConnector.getColumnHeaders = function() {

      var connectionData;

      try{
          connectionData = JSON.parse(tableau.connectionData);
      }
      catch(ex){
          abort("Error parsing tableau connection data: \n", ex);
          return;
      }

    
    tableau.log('getColumnHeaders called, headers: ' + _.pluck(connectionData.fields, 'name').join(', '));
    tableau.headersCallback(_.pluck(connectionData.fields, 'name'), _.pluck(connectionData.fields, 'dataType'));
  };
   
  var totalCount = 0,
      searchHitsTotal = -1;

     myConnector.getTableData = function(lastRecordToken){

         console.log('[getTableData] lastRecordToken: ' + lastRecordToken);
         var connectionData = JSON.parse(tableau.connectionData);

         if(connectionData.elasticsearchAuthenticate){
             console.log('[getTableData] Using HTTP Basic Auth, username: ' +
                 tableau.username + ', password: ' + tableau.password);
         }

         // First time this is invoked
         if(!lastRecordToken){
             console.log('[getTableData] open search scroll window...');
             openSearchScrollWindow(function(err, scrollId){
                 console.log('[getTableData] opened scroll window, scroll id: ' + scrollId);
             });
         }
         else{
             console.log('[getTableData] getting next scroll result...');

             getNextScrollResult(lastRecordToken, function(err, results){
                 console.log('[getTableData] processed next scroll result, count: ' + results.length);
             })
         }

     };

  myConnector.init = function(){

      console.log('[connector.init] fired');

      if (tableau.phase == tableau.phaseEnum.interactivePhase){
          $('.no-tableau').css('display', 'none');
          $('.tableau').css('display', 'block');

          initUIControls();
      }
    
    tableau.initCallback();
  }

  myConnector.shutdown = function(){
      endTime = moment();
      var runTime = endTime.diff(startTime) / 1000;
      $('#myPleaseWait').modal('hide');
      
      $('#divError').css('display', 'none');      
      $('#divMessage').css('display', 'block');
      $('#messageText').text(totalCount + ' total rows retrieved, in: ' + runTime + ' (s)');  
      
      $('html, body').animate({
        scrollTop: $("#divMessage").offset().top
    }, 500);
    
      console.log('[connector.shutdown] callback...');
      tableau.shutdownCallback();
  };
  
  tableau.registerConnector(myConnector);

  //
  // Setup connector UI
  //
 
  $(document).ready(function() {

      console.log('[$.document.ready] fired...');

  });

     var initUIControls = function(){
         $('#cbUseQuery').change(function() {
             if($(this).is(":checked")) {
                 $('#divQuery').css('display', 'block');
             }
             else{
                 $('#divQuery').css('display', 'none');
                 $('#inputUsername').val('');
                 $('#inputPassword').val('');
             }

             updateTableauConnectionData();
         });

         $('#cbUseBasicAuth').change(function() {
             if($(this).is(":checked")) {
                 $('.basic-auth-control').css('display', 'block');
             }
             else{
                 $('.basic-auth-control').css('display', 'none');
                 $('#textElasticsearchQuery').val('');
             }

             updateTableauConnectionData();
         });

         $("#submitButton").click(function(e) { // This event fires when a button is clicked
             e.preventDefault();

             // Retrieve the Elasticsearch mapping before we call tableau submit
             // There is a bug when getColumnHeaders is invoked, and you call 'headersCallback'
             // asynchronously
             getElasticsearchTypeMapping(getTableauConnectionData());

         });

         $("#inputElasticsearchIndexTypeahead").typeahead({source: function(something, cb){

             getElasticsearchIndices(function(err, indices){

                 if(err){
                     return abort(err);
                 }

                 getElasticsearchAliases(function(err, aliases){

                     if(err){
                         return abort(err);
                     }
                     var sourceData = indices.concat(_.uniq(aliases));

                     // Return the actual list of items to the control
                     cb(sourceData);
                 });

             });
         },
             autoSelect: true,
             showHintOnFocus: true,
             items: 'all' });

         $("#inputElasticsearchTypeTypeahead").typeahead({source:function(something, cb){

             var connectionData = getTableauConnectionData();
             getElasticsearchTypes(connectionData.elasticsearchIndex, function(err, types){
                 if(err){
                     return abort(err);
                 }

                 // Return the actual list of items to the control
                 cb(types);
             });
         },
             autoSelect: true,
             showHintOnFocus: true,
             items: 'all' });

     };
  
  var getElasticsearchTypes = function (indexName, cb) {

      var connectionData = getTableauConnectionData();

      if(!connectionData.elasticsearchUrl || !connectionData.elasticsearchIndex){
          return;
      }

      var connectionUrl = connectionData.elasticsearchUrl + '/' + indexName + '/_mapping';

      var xhr = $.ajax({
          url: connectionUrl,
          method: 'GET',
          contentType: 'application/json',
          dataType: 'json',
          beforeSend: function (xhr) {
              if (connectionData.elasticsearchAuthenticate && tableau.username) {
                  xhr.setRequestHeader("Authorization", "Basic " +
                      btoa(tableau.username + ":" + tableau.password));
              }

          },
          success: function (data) {

              var indices = _.keys(data);
              var typeMap = {};
              
              var esTypes = [];
              
              _.each(indices, function(index){
                  var types = _.keys(data[index].mappings);
                  
                  esTypes = esTypes.concat(types);
              });

              cb(null, esTypes);
          },
          error: function (xhr, ajaxOptions, err) {
              if (xhr.status == 0) {
                  cb('Request error, unable to connect to host or CORS request was denied');
              }
              else {
                  cb("Request error, status code:  " + xhr.status + '; ' + xhr.responseText + "\n" + err);
              }
          }
      });
  }
  
  var getElasticsearchIndices = function(cb){
      
      var connectionData = getTableauConnectionData();

      if(!connectionData.elasticsearchUrl){
          return;
      }

      var connectionUrl = connectionData.elasticsearchUrl + '/_mapping';

      var xhr = $.ajax({
          url: connectionUrl,
          method: 'GET',
          contentType: 'application/json',
          dataType: 'json',
          beforeSend: function (xhr) {
              if (connectionData.elasticsearchAuthenticate && tableau.username) {
                  xhr.setRequestHeader("Authorization", "Basic " +
                      btoa(tableau.username + ":" + tableau.password));
              }

          },
          success: function (data) {

              var indices = _.keys(data);

              cb(null, indices);
          },
          error: function (xhr, ajaxOptions, err) {
              if (xhr.status == 0) {
                  cb('Request error, unable to connect to host or CORS request was denied');
              }
              else {
                  cb("Request error, status code:  " + xhr.status + '; ' + xhr.responseText + "\n" + err);
              }
          }
      });
  }
  
    var getElasticsearchAliases = function(cb){
      
      var connectionData = getTableauConnectionData();

        if(!connectionData.elasticsearchUrl){
            return;
        }

      var connectionUrl = connectionData.elasticsearchUrl + '/_aliases';

      var xhr = $.ajax({
          url: connectionUrl,
          method: 'GET',
          contentType: 'application/json',
          dataType: 'json',
          beforeSend: function (xhr) {
              if (connectionData.elasticsearchAuthenticate && tableau.username) {
                  xhr.setRequestHeader("Authorization", "Basic " +
                      btoa(tableau.username + ":" + tableau.password));
              }

          },
          success: function (data) {

              var aliasMap = {},
                  aliases = [];
                  
              _.forIn(data, function(value, key){
                  aliases = aliases.concat(_.keys(value.aliases));
              });

              cb(null, aliases);
          },
          error: function (xhr, ajaxOptions, err) {
              if (xhr.status == 0) {
                  cb('Request error, unable to connect to host or CORS request was denied');
              }
              else {
                  cb("Request error, status code:  " + xhr.status + '; ' + xhr.responseText + "\n" + err);
              }
          }
      });
  };

     var openSearchScrollWindow = function(cb){

         var connectionData = JSON.parse(tableau.connectionData);

         if(!connectionData.elasticsearchUrl){
             return;
         }

         var requestData = {};
         if(connectionData.elasticsearchQuery){
             try{
                 requestData = JSON.parse(connectionData.elasticsearchQuery);
             }
             catch(err){
                 abort("Error parsing custom query: \n" + err);
                 return;
             }
         }
         else{
             requestData = {
                 query: { match_all: {} }
             };
         }

         requestData.size = connectionData.batchSize;

         var connectionUrl = connectionData.elasticsearchUrl + '/' + connectionData.elasticsearchIndex + '/' +
             connectionData.elasticsearchType + '/_search?scroll=5m';

         var xhr = $.ajax({
             url: connectionUrl,
             method: 'POST',
             processData: false,
             data: JSON.stringify(requestData),
             dataType: 'json',
             beforeSend: function (xhr) {
                 if (connectionData.elasticsearchAuthenticate && tableau.username) {
                     xhr.setRequestHeader("Authorization", "Basic " +
                         btoa(tableau.username + ":" + tableau.password));
                 }

             },
             success: function (data) {

                 var result = processSearchResults(data);

                 cb(null, result.scrollId);
             },
             error: function (xhr, ajaxOptions, err) {
                 if (xhr.status == 0) {
                     cb('Request error, unable to connect to host or CORS request was denied');
                 }
                 else {
                     cb("Error creating Elasticsearch scroll window, status code:  " + xhr.status + '; ' + xhr.responseText + "\n" + err);
                 }
             }
         });
     };

     var getNextScrollResult = function(scrollId, cb){
         var connectionData = JSON.parse(tableau.connectionData);

         if(!connectionData.elasticsearchUrl){
             return;
         }

         var connectionUrl = connectionData.elasticsearchUrl + '/_search/scroll';

         var requestData = {
             scroll: '5m',
             scroll_id: scrollId
         };

         var xhr = $.ajax({
             url: connectionUrl,
             method: 'POST',
             processData: false,
             data: JSON.stringify(requestData),
             dataType: 'json',
             beforeSend: function (xhr) {
                 if (connectionData.elasticsearchAuthenticate && tableau.username) {
                     xhr.setRequestHeader("Authorization", "Basic " +
                         btoa(tableau.username + ":" + tableau.password));
                 }

             },
             success: function (data) {
                 var result = processSearchResults(data);

                 if(cb){
                     cb(null, result.results);
                 }
             },
             error: function (xhr, ajaxOptions, err) {
                 if (xhr.status == 0) {
                     cb('Request error, unable to connect to host or CORS request was denied');
                 }
                 else {
                     cb("Error creating Elasticsearch scroll window, status code:  " + xhr.status + '; ' + xhr.responseText + "\n" + err);
                 }
             }
         });
     };

    //RA - recursion for nested objects
    var traverse = function (obj, key, ret)
    {
      if (obj !== null && obj !== undefined && typeof obj == 'object')
      {
        $.each(obj, function(k, v) {
          var kLocal = k;
          if (key != "") kLocal = key + "." + k;
          if (v !== null && v !== undefined && typeof v == 'object')
          {
            traverse(v, kLocal, ret); 
          }
          else
          {
            ret[kLocal] = v;
          }
        });
      }
    };

     var processSearchResults = function(data){

         var connectionData = JSON.parse(tableau.connectionData);
         searchHitsTotal = data.hits.total;

         console.log('[processSearchResults] total search hits: ' + searchHitsTotal);

         if (data.hits.hits) {
             var hits = data.hits.hits;
             var ii;
             var toRet = [];

             var hitsToProcess = hits.length;
             if(connectionData.limit && (totalCount + hits.length > connectionData.limit)){
                 hitsToProcess = connectionData.limit - totalCount;
             }

             // mash the data into an array of objects
             for (ii = 0; ii < hitsToProcess; ++ii) {

                 var item = hits[ii]._source;
                 var key = "";

                 //RA - recusrion for nested objects
                 traverse(hits[ii]._source, key, item);  

                // Copy over any formatted value to the source object
                 _.each(connectionData.dateFields, function(field){

                     if(!item[field]){
                         item[field] = null;
                         return;
                     }

                     item[field] = moment(item[field].replace(' +', '+')
                         .replace(' -', '-')).format('YYYY-MM-DD HH:mm:ss');
                 });
                 _.each(connectionData.geoPointFields, function(field){
                     var latLonParts = item[field.name] ? item[field.name].split(', ') : [];
                     if(latLonParts.length != 2){
                         console.log('[getTableData] Bad format returned for geo_point field: ' + field.name + '; value: ' + item[field.name]);
                         return;
                     }
                     item[field.name + '_latitude'] = parseFloat(latLonParts[0]);
                     item[field.name + '_longitude'] = parseFloat(latLonParts[1]);
                 });
                 item._id = hits[ii]._id;
                 //item._sequence = requestData.from + ii;

                 toRet.push(item);
             }

             totalCount += hitsToProcess;
             // If we have a limit, retrieve up to that limit, otherwise
             // wait until we have no more results returned

             var moreRecords =  connectionData.limit ? totalCount < connectionData.limit : data.hits.hits.length > 0;
             console.log('[processSearchResults] total processed ' + totalCount + ', limit: ' +
                         connectionData.limit + ' more records?: ' + moreRecords);

             tableau.dataCallback(toRet, data._scroll_id, moreRecords);

             return {results: toRet, scrollId: data._scroll_id };

         } else {
             console.log("[getNextScrollResult] No results found for Elasticsearch query: " + JSON.stringify(requestData));
             tableau.dataCallback([]);

             return([]);
         }
     };
  
  var getTableauConnectionData = function(){
    
    var max_iterations = parseInt($('#inputBatchSize').val()) == NaN ? 10 : parseInt($('#inputBatchSize').val());
    var limit = parseInt($('#inputTotalLimit').val()) == NaN ? null : parseInt($('#inputTotalLimit').val());
    var connectionName = $('#inputConnectionName').val();
    var auth = $('#cbUseBasicAuth').is(':checked');
    var username = $('#inputUsername').val();
    var password = $('#inputPassword').val();
    var esUrl = $('#inputElasticsearchUrl').val();
    var esIndex = $('#inputElasticsearchIndexTypeahead').val();
    var esType = $('#inputElasticsearchTypeTypeahead').val();
    var esQuery = $('#textElasticsearchQuery').val();
    
    var connectionData = {
        elasticsearchUrl: esUrl,
        elasticsearchAuthenticate: auth,
        elasticsearchUsername: username,
        elasticsearchPassword: password,
        elasticsearchIndex: esIndex,
        elasticsearchType: esType,
        elasticsearchQuery: esQuery,
        fields: elasticsearchFields,
        fieldsMap: elasticsearchFieldsMap,
        dateFields: elasticsearchDateFields,
        geoPointFields: elasticsearchGeoPointFields,
        batchSize:  max_iterations,
        limit: limit
      };

      // Update Tableau auth parameters if supplied
      if(connectionData.elasticsearchAuthenticate){
          tableau.username = connectionData.elasticsearchUsername;
          tableau.password = connectionData.elasticsearchPassword;
      }
      
      return connectionData; 
  };
  
  var updateTableauConnectionData = function(updatedMap){
    
      var connectionData = getTableauConnectionData();
      
      if(updatedMap){
          _.forIn(updateMap, function(val, key){
              connectionData[key] = val;
          });        
      }

      if(connectionData.elasticsearchAuthenticate){
          tableau.username = connectionData.elasticsearchUsername;
          tableau.password = connectionData.elasticsearchPassword;
      }

      delete connectionData.elasticsearchUsername;
      delete connectionData.elasticsearchPassword;

      tableau.connectionData = JSON.stringify(connectionData);  
      
      console.log('[updateTableauConnectionData] Connection data: ' + tableau.connectionData);
      return connectionData; 
  };
    
})();