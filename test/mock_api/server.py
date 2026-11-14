#!/usr/bin/env python3
"""Deterministic NOAA-shaped responses for tests; never contacts the network."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timedelta
import json
import os

class Handler(BaseHTTPRequestHandler):
    seen = set()
    def log_message(self, *_): pass
    def send(self, value, status=200, content_type="application/json", headers=None):
        body=(json.dumps(value) if content_type == "application/json" else value).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for k,v in (headers or {}).items(): self.send_header(k,v)
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        url=urlparse(self.path)
        q={k:v[0] for k,v in parse_qs(url.query).items()}
        if os.environ.get("MOCK_API_FLAKY") and self.path not in self.seen:
            self.seen.add(self.path)
            return self.send({"error":"rate limited"},429,headers={"Retry-After":"0"})
        try:
            self.route(url.path,q)
        except (ValueError, KeyError, AssertionError) as error:
            self.send({"error":{"message":str(error)}},400)
    def route(self, path, q):
        if path == "/stations.json":
            assert q.get("type") in ["waterlevels","tidepredictions","currents","currentpredictions"], "missing station type"
            if q["type"]=="currentpredictions":
                # NOAA lists a current-prediction station once per depth bin (currbin).
                return self.send({"stations":[{"id":"cb0102","name":"Cape Henry","lat":36.96,"lng":-76.01,"type":"H","currbin":b} for b in (4,9)]})
            return self.send({"stations":[{"id":"8518750","name":"The Battery","lat":40.7,"lng":-74.01,"state":"NY","type":"R"},{"id":"9414290","name":"San Francisco","lat":37.8,"lng":-122.46,"state":"CA","type":"R"}]})
        if path.endswith("/bins.json"):
            assert q.get("units") == "metric"
            return self.send({"bins":None if "0000000" in path else [{"num":1,"depth":1.8,"qc_flag":1},{"bin":2,"depth":3.6,"qc_flag":0}]})
        if path != "/datagetter": return self.send({},404)
        for key,value in {"units":"metric","time_zone":"gmt","format":"json","application":"QueryFarm_vgi_tides"}.items():
            assert q.get(key)==value, f"wrong {key}"
        if q["station"]=="9999999": return self.send({"error":{"message":"Invalid station or unsupported product"}})
        if q["station"]=="0000000": return self.send({"error":{"message":"No data was found. This product may not be offered at this station."}})
        if q["station"]=="8888888": return self.send({"unexpected":[]})
        if q["station"]=="HTTP001": return self.send({},404)
        if q["product"]=="currents_predictions" and q.get("bin")=="99":
            return self.send({"error":{"message":f"Available bin number of {q['station']}: 1, 2, "}},400)
        start=datetime.strptime(q["begin_date"],"%Y%m%d")
        end=datetime.strptime(q["end_date"],"%Y%m%d")
        assert 0 <= (end-start).days <= 6, "request exceeds seven inclusive days"
        product=q["product"]
        rows=[]
        day=start
        while day<=end:
            if product=="predictions":
                assert q.get("datum") in ["MLLW","MSL"], "datum not forwarded"
                step=q["interval"]
                minutes=[0,360,720,1080] if step=="hilo" else list(range(0,1440,60 if step=="h" else int(step)))
                for i,minute in enumerate(minutes):
                    r={"t":(day+timedelta(minutes=minute)).strftime("%Y-%m-%d %H:%M"),"v":str([1.2,.2,1.5,.1][i%4])}
                    if step=="hilo":r["type"]="H" if i%2==0 else "L"
                    rows.append(r)
            elif product=="water_level":
                assert q.get("datum") in ["MLLW","MSL"]
                for i,value in enumerate(["1.2","0","","-0.3"]):
                    rows.append({"t":(day+timedelta(hours=i*6)).strftime("%Y-%m-%d %H:%M"),"v":value,"s":"0.01","q":"p","f":"1,0,0,0"})
            elif product=="currents_predictions":
                assert q.get("interval") in ["max_slack","h","1","6","10","30","60"]
                for i,(event,speed) in enumerate([("flood",25),("slack",0),("ebb",-12.5),("slack",0)]):
                    rows.append({"Time":(day+timedelta(hours=i*6)).strftime("%Y-%m-%d %H:%M"),"Velocity_Major":speed,"Type":event,"Bin":q["bin"],"Depth":"1.8","meanFloodDir":9,"meanEbbDir":198})
            elif product=="currents":
                bins=[1,2] if q["bin"]=="0" else [int(q["bin"])]
                for b in bins:rows.append({"t":day.strftime("%Y-%m-%d %H:%M"),"s":str(25*b),"d":"90","b":str(b)})
            else: raise ValueError("unsupported product")
            day+=timedelta(days=1)
        return self.send({"predictions":rows} if product=="predictions" else {"current_predictions":{"units":"meters, cm/s","cp":rows}} if product=="currents_predictions" else {"data":rows})

if __name__ == "__main__":
    server=ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("MOCK_API_PORT","0"))),Handler)
    print(f"PORT:{server.server_address[1]}",flush=True)
    server.serve_forever()
