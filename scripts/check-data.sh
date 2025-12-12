#!/bin/bash

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Varken - InfluxDB Data Check${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if containers are running
if ! docker ps --format '{{.Names}}' | grep -q "varken-influxdb1"; then
    echo -e "${YELLOW}Warning: varken-influxdb1 container is not running${NC}"
    INFLUX1_RUNNING=false
else
    INFLUX1_RUNNING=true
fi

if ! docker ps --format '{{.Names}}' | grep -q "varken-influxdb2"; then
    echo -e "${YELLOW}Warning: varken-influxdb2 container is not running${NC}"
    INFLUX2_RUNNING=false
else
    INFLUX2_RUNNING=true
fi

# InfluxDB 1.x
if [ "$INFLUX1_RUNNING" = true ]; then
    echo -e "${GREEN}=== InfluxDB 1.x (port 8086) ===${NC}"
    echo ""

    echo -e "${BLUE}Measurements:${NC}"
    # Get measurements list
    MEASUREMENTS=$(docker exec varken-influxdb1 influx -database varken -execute 'SHOW MEASUREMENTS' 2>/dev/null | grep -v "^name" | grep -v "^----" | grep -v "^$" | tr -d '\r')
    if [ -n "$MEASUREMENTS" ]; then
        echo "$MEASUREMENTS"
    else
        echo "No measurements found"
    fi
    echo ""

    for measurement in $MEASUREMENTS; do
        if [ -n "$measurement" ]; then
            echo -e "${BLUE}$measurement:${NC}"

            # Get count of records
            COUNT=$(docker exec varken-influxdb1 influx -database varken -execute "SELECT COUNT(*) FROM \"$measurement\"" 2>/dev/null | grep -E "^[0-9]" | awk '{print $2}' | head -1)

            if [ -n "$COUNT" ] && [ "$COUNT" != "0" ]; then
                echo "  Records: $COUNT"

                # Get last record time
                LAST_TIME=$(docker exec varken-influxdb1 influx -database varken -execute "SELECT * FROM \"$measurement\" ORDER BY time DESC LIMIT 1" 2>/dev/null | grep -E "^[0-9]" | awk '{print $1}')
                if [ -n "$LAST_TIME" ]; then
                    # Convert nanoseconds to readable UTC date
                    LAST_DATE=$(TZ=UTC date -d @$((LAST_TIME / 1000000000)) '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo "$LAST_TIME")
                    echo "  Last update: $LAST_DATE"
                fi

                # Get types available
                TYPES=$(docker exec varken-influxdb1 influx -database varken -execute "SHOW TAG VALUES FROM \"$measurement\" WITH KEY = \"type\"" 2>/dev/null | grep -v "^key" | grep -v "^---" | grep -v "^name" | grep -v "^$" | awk '{print $2}' | tr -d '\r' | sort -u | tr '\n' ', ' | sed 's/,$//')
                if [ -n "$TYPES" ]; then
                    echo "  Types: $TYPES"
                fi
            else
                echo "  No records found"
            fi
            echo ""
        fi
    done
fi

# InfluxDB 2.x
if [ "$INFLUX2_RUNNING" = true ]; then
    echo -e "${GREEN}=== InfluxDB 2.x (port 8087) ===${NC}"
    echo ""

    echo -e "${BLUE}Measurements:${NC}"
    # Get measurements - InfluxDB 2 returns CSV format with header lines starting with # or ,result
    # Data lines look like: ,,0,Sonarr (empty,empty,index,measurement_name)
    RAW_OUTPUT=$(docker exec varken-influxdb2 influx query \
        --org varken \
        --token varken-test-token \
        --raw \
        'import "influxdata/influxdb/schema" schema.measurements(bucket: "varken")' 2>/dev/null)

    # Extract measurement names: filter data lines (start with ,,) and get the last field
    # Use tr -d '\r' to remove Windows-style carriage returns from Docker output
    MEASUREMENTS=$(echo "$RAW_OUTPUT" | tr -d '\r' | grep "^,," | awk -F',' '{print $4}' | grep -v "^$" | sort -u)

    if [ -n "$MEASUREMENTS" ]; then
        echo "$MEASUREMENTS"
    else
        echo "No measurements found"
    fi
    echo ""

    # Show record count and sample data for each measurement
    for measurement in $MEASUREMENTS; do
        if [ -n "$measurement" ]; then
            echo -e "${BLUE}$measurement:${NC}"

            # Get count of records in last 7 days
            COUNT=$(docker exec varken-influxdb2 influx query \
                --org varken \
                --token varken-test-token \
                --raw \
                "from(bucket: \"varken\") |> range(start: -7d) |> filter(fn: (r) => r._measurement == \"$measurement\") |> group() |> count()" 2>/dev/null \
                | tr -d '\r' | grep "^,," | awk -F',' '{print $NF}' | head -1)

            if [ -n "$COUNT" ] && [ "$COUNT" != "0" ]; then
                echo "  Records (7d): $COUNT"

                # Get last record time and key fields using CSV format for easier parsing
                LAST_RECORD=$(docker exec varken-influxdb2 influx query \
                    --org varken \
                    --token varken-test-token \
                    --raw \
                    "from(bucket: \"varken\") |> range(start: -7d) |> filter(fn: (r) => r._measurement == \"$measurement\") |> last()" 2>/dev/null \
                    | tr -d '\r' | grep -v "^#" | grep -v "^$" | grep -v "^,result" | head -5)

                if [ -n "$LAST_RECORD" ]; then
                    # Extract _time from the last record (6th column in CSV: result,table,_start,_stop,_time,...)
                    LAST_TIME=$(echo "$LAST_RECORD" | head -1 | awk -F',' '{print $6}')
                    if [ -n "$LAST_TIME" ]; then
                        echo "  Last update: $LAST_TIME"
                    fi
                fi

                # Show types available for this measurement
                TYPES=$(docker exec varken-influxdb2 influx query \
                    --org varken \
                    --token varken-test-token \
                    --raw \
                    "import \"influxdata/influxdb/schema\" schema.tagValues(bucket: \"varken\", tag: \"type\", predicate: (r) => r._measurement == \"$measurement\")" 2>/dev/null \
                    | tr -d '\r' | grep "^,," | awk -F',' '{print $NF}' | sort -u | tr '\n' ', ' | sed 's/,$//')

                if [ -n "$TYPES" ]; then
                    echo "  Types: $TYPES"
                fi
            else
                echo "  No records found"
            fi
            echo ""
        fi
    done
fi

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Check complete${NC}"
echo -e "${BLUE}========================================${NC}"
