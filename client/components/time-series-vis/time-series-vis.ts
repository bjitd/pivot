'use strict';

import { List } from 'immutable';
import * as React from 'react/addons';
import * as d3 from 'd3';
import * as numeral from 'numeral';
import { $, Dispatcher, Expression, Dataset, Datum, TimeRange } from 'plywood';
import { bindOne, bindMany } from "../../utils/render";
import { Stage, SplitCombine, Filter, Dimension, Measure, DataSource } from "../../models/index";
import { ChartLine } from '../chart-line/chart-line';
import { TimeAxis } from '../time-axis/time-axis';
import { VerticalAxis } from '../vertical-axis/vertical-axis';
import { GridLines } from '../grid-lines/grid-lines';

const H_PADDING = 10;
const TITLE_TEXT_LEFT = 6;
const TITLE_TEXT_TOP = 17;
const TEXT_SPACER = 20;
const Y_AXIS_WIDTH = 60;
const GRAPH_HEIGHT = 100;
const MAX_GRAPH_WIDTH = 2000;

function midpoint(timeRange: TimeRange): Date {
  return new Date((timeRange.start.valueOf() + timeRange.end.valueOf()) / 2);
}

function getTimeExtent(dataset: Dataset, splits: List<SplitCombine>): [Date, Date] {
  if (!splits || !splits.size) return null;
  var extentData: Date[] = [];
  var lastSplitDatasets: Dataset[] = [dataset.data[0]['Split']];

  // ToDo: flatten / map

  var lastSplitDimension = splits.last().dimension;
  for (var lastSplitDataset of lastSplitDatasets) {
    var lastSplitData = lastSplitDataset.data;
    if (!lastSplitData.length) continue;
    extentData.push(
      lastSplitData[0][lastSplitDimension].start,
      lastSplitData[lastSplitData.length - 1][lastSplitDimension].end
    );
  }

  if (!extentData.length) return null;
  return d3.extent(extentData);
}

interface TimeSeriesVisProps {
  dataSource: DataSource;
  filter: Filter;
  splits: List<SplitCombine>;
  measures: List<Measure>;
  stage: Stage;
}

interface TimeSeriesVisState {
  dataset: Dataset;
}

export class TimeSeriesVis extends React.Component<TimeSeriesVisProps, TimeSeriesVisState> {
  public mounted: boolean;

  constructor() {
    super();
    this.state = {
      dataset: null
    };
  }

  fetchData(filter: Filter, measures: List<Measure>) {
    var { dataSource, splits } = this.props;
    var $main = $('main');

    var query: any = $()
      .apply('main', $main.filter(filter.toExpression()));

    measures.forEach((measure) => {
      query = query.apply(measure.name, measure.expression);
    });

    splits.forEach((split, i) => {
      var isLast = i === splits.size - 1;
      var subQuery = $main.split(split.splitOn, split.dimension);

      measures.forEach((measure) => {
        subQuery = subQuery.apply(measure.name, measure.expression);
      });
      if (isLast) {
        subQuery = subQuery.sort($(split.dimension), 'ascending');
      } else {
        subQuery = subQuery.sort($(measures.first().name), 'descending').limit(5);
      }

      query = query.apply('Split', subQuery);
    });

    dataSource.dispatcher(query).then((dataset) => {
      if (!this.mounted) return;
      this.setState({ dataset });
    });
  }

  componentDidMount() {
    this.mounted = true;
    var { filter, measures } = this.props;
    this.fetchData(filter, measures);
  }

  componentWillReceiveProps(nextProps: TimeSeriesVisProps) {
    var props = this.props;
    if (props.filter !== nextProps.filter || props.measures !== nextProps.measures) {
      this.fetchData(nextProps.filter, nextProps.measures);
    }
  }

  componentWillUnmount() {
    this.mounted = false;
  }

  render() {
    var { filter, splits, measures, stage } = this.props;
    var { dataset } = this.state;

    var numberOfColumns = Math.ceil(stage.width / MAX_GRAPH_WIDTH);

    var measureGraphs: Array<React.ReactElement<any>> = null;
    var bottomAxes: Array<React.ReactElement<any>> = null;

    if (dataset && splits.size) {
      var extentX = getTimeExtent(dataset, splits);
      // if (!extentX)

      var myDatum: Datum = dataset.data[0];
      var myDataset: Dataset = myDatum['Split'];

      var splitName = splits.last().dimension;
      var getX = (d: Datum) => midpoint(d[splitName]);

      var parentWidth = stage.width - H_PADDING * 2;
      var svgStage = new Stage({
        x: H_PADDING,
        y: 0,
        width: Math.floor(parentWidth / numberOfColumns),
        height: TEXT_SPACER + GRAPH_HEIGHT
      });

      var lineStage = svgStage.within({ top: TEXT_SPACER, right: Y_AXIS_WIDTH });
      var yAxisStage = svgStage.within({ top: TEXT_SPACER, left: lineStage.width });

      var scaleX = d3.time.scale()
        .domain(extentX)
        .range([0, lineStage.width]);

      var xTicks = scaleX.ticks();

      var measuresArray = measures.toArray();
      measureGraphs = measuresArray.map((measure) => {
        var measureName = measure.name;
        var getY = (d: Datum) => d[measureName];
        var extentY = d3.extent(myDataset.data, getY);

        if (isNaN(extentY[0])) {
          return JSX(`
            <svg className="measure-graph" key={measure.name} width={svgStage.width} height={svgStage.height}>
              <text x={TITLE_TEXT_LEFT} y={TITLE_TEXT_TOP}>{measure.title + ': Loading'}</text>
            </svg>
          `);
        }

        extentY[0] = Math.min(extentY[0] * 1.1, 0);
        extentY[1] = Math.max(extentY[1] * 1.1, 0);

        var scaleY = d3.scale.linear()
          .domain(extentY)
          .range([lineStage.height, 0]);

        var yTicks = scaleY.ticks().filter((n: number, i: number) => n !== 0 && i % 2 === 0);

        return JSX(`
          <svg className="measure-graph" key={measureName} width={svgStage.width} height={svgStage.height}>
            <GridLines
              orientation="horizontal"
              scale={scaleY}
              ticks={yTicks}
              stage={lineStage}
            />
            <GridLines
              orientation="vertical"
              scale={scaleX}
              ticks={xTicks}
              stage={lineStage}
            />
            <ChartLine
              dataset={myDataset}
              getX={getX}
              getY={getY}
              scaleX={scaleX}
              scaleY={scaleY}
              stage={lineStage}
            />
            <VerticalAxis
              stage={yAxisStage}
              yTicks={yTicks}
              scaleY={scaleY}
            />
            <text x={TITLE_TEXT_LEFT} y={TITLE_TEXT_TOP}>
              {measure.title + ': ' + numeral(myDatum[measureName]).format(measure.format)}
            </text>
          </svg>
        `);
      });

      var xAxisStage = Stage.fromSize(svgStage.width, 50);
      bottomAxes = [];
      for (var i = 0; i < numberOfColumns; i++) {
        bottomAxes.push(JSX(`
          <svg className="bottom-axis" key={'bottom-axis-' + i} width={xAxisStage.width} height={xAxisStage.height}>
            <TimeAxis stage={xAxisStage} xTicks={xTicks} scaleX={scaleX}/>
          </svg>
        `));
      }
    }

    return JSX(`
      <div className="time-series-vis">
        {measureGraphs}
        {bottomAxes}
      </div>
    `);
  }
}
