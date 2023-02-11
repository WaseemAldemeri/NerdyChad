
const sqlite3 = require('sqlite3').verbose();

let db = new sqlite3.Database('./database.db', sqlite3.OPEN_READWRITE);

const { Client, GatewayIntentBits, SelectMenuOptionBuilder } = require("discord.js");
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent, 
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const config = require("./config.json");


const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function get_date(numeric_date) {

  let date = new Date(numeric_date);
    let year = date.getFullYear();
    let month = date.getMonth() + 1;
    let day = date.getDate();
    let joined_date = `${year}/${month}/${day}`;
    let hour = date.getHours();
    let minutes = date.getMinutes();
    let str_hour = (hour).toLocaleString('en-US', {minimumIntegerDigits: 2, useGrouping:false});
    let str_minute = (minutes).toLocaleString('en-US', {minimumIntegerDigits: 2, useGrouping:false});
    let hour_minutes = `${str_hour}:${str_minute}`;

  return {
    'numeric_date': numeric_date,
    'year': year,
    'month': month,
    'day': day,
    'joined_date': joined_date,
    'hour': hour,
    'minutes': minutes,
    'hour_minutes': hour_minutes
  };
}


const get_duration = (sql, data) => {
	return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.all(sql, data, (err, rows) => {
        if (err) reject(err);
        resolve(rows);
      });
    });
	});
};

async function caculate_time(sql,data) {

  let promise = await get_duration(sql,data);
  let rows = await promise;

  let total_time = 0;
  let sessions = [];

  rows.forEach((row) => {
    total_time += row.duration;
    if (row.hour_minutes && Math.round(row.duration /  60) >= 3) {
      sessions.push({'hour_minutes': row.hour_minutes, 'duration': Math.round(row.duration /  60)})
    }
  });
  
  let minutes = Math.round((total_time % 3600) / 60);
  let hours = Math.trunc(total_time / 3600);
  let hours_rounded = Math.round(total_time / 3600);

  return {
    'hours': hours,
    'hours_rounded': hours_rounded,
    'minutes': minutes,
    'total': total_time,
    'sessions': sessions
  };

};


async function database_users() {

  let promise = await get_database_users();
  let database_users = await promise;
  return database_users;

};


const get_database_users = () => {
	return new Promise((resolve, reject) => {
    let database_users = [];
    let sql = "SELECT * FROM users";
    db.serialize(() => {
      db.all(sql, [], (err, rows) => {
        rows.forEach((row) => {
          database_users.push(row.id);
        })
        resolve(database_users)
      });
    });
	});
};


async function caculate_members(guildId, sql) {

  let promise = await get_members(guildId);
  let members = await promise;
  let users = [];

  for (let i = 0; i < members.length; i++) {
    let time = await caculate_time(sql, [members[i].id]);
    users.push({'time': time, 'username': members[i].username})
  }

  let sorted = users.sort((a, b) => b.time.total - a.time.total)


  return sorted;

};

const get_members = (guildId) => {
  let guild = client.guilds.cache.get(guildId)
	return new Promise((resolve, reject) => {
    let users = [];
    guild.members.fetch().then(members => {
      members.forEach((member) => {
        if (!member.user.bot) {
          users.push(member.user)
        }
      });
      resolve(users)
    });
	});
};



client.on("ready", () => {


  const Guilds = client.guilds.cache.map(guild => guild.id);
  
  
  for (let i = 0; i < Guilds.length; i++) {
    
    //populate database
    let guild = client.guilds.cache.get(Guilds[i]);
    guild.members.fetch().then(users_in_server => {
      users_in_server.forEach(async member => {
        let users_in_database = await database_users();
        db.serialize(() => {
          if (users_in_database.includes(member.user.id) === false && !member.user.bot) {
            console.log('New User ADDED')
            let sql = "INSERT INTO users (id) VALUES (?)";
            let data = [member.user.id];
            db.run(sql, data)
            sql = "INSERT INTO duration (user_id) VALUES (?)";
            db.run(sql, data)
          }
        });
      });
    });
    //start recoding sessions for users that are already in a voice channel
    guild.members.fetch().then(members => {
      members.forEach(member => {
        if (member.voice.channel && !member.user.bot) {
          console.log(member.user.username + ' joined');
          let user_id = member.user.id;
          let start_time = Date.now();
          let sql = "UPDATE duration SET start_time = (?) WHERE user_id = (?)";
          let data = [start_time, user_id]
          db.run(sql, data)
        }
      })
    })

  }



  const interval = setInterval(async function() {

    let date = get_date(Date.now());
    const Guilds = client.guilds.cache.map(guild => guild.id);
    
    if (date.day === 1 && date.hour === 12 && date.minutes === 0) {
      //monthly leaderboards
      for (let j = 0; j < Guilds.length; j++) {
        
        let messages = [];
        messages.push(`Leaderboards for ${months[date.month - 1]}:-`)
        let guild = client.guilds.cache.get(Guilds[j]);
        let sql = `SELECT duration FROM sessions WHERE user_id = (?) And month = ${get_date(Date.now()).month}`;
        let users = await caculate_members(Guilds[j], sql)
        for (let i = 0; i < users.length; i++) {
          if (i === 10) {
            break;
          } else if (i === 0) {
            messages.push(`Congratiolations for ${users[i].username} on wininng the Nerd Of The Month Award with ${users[i].time.hours_rounded} hours studied.`)
            //add award for user in database
          } else {
            messages.push(`${i + 1}. ${users[i].username} with ${users[i].time.hours_rounded} hours studied.`)
          }
        }
        //send leaderboards to chat channels
        let channels = guild.channels.cache.filter(channel => channel.isTextBased());
        channels.forEach((channel) => {
          channel.send(messages.join('\n'))
        })

      }
    }

  }, 60 * 1000 );

  console.log("bot is ready");

});




client.on("guildMemberAdd", async (member) => {
  console.log(`New User "${member.user.username}" has joined "${member.guild.name}"` );
  //add the user to the database
  let users_in_database = await database_users();
  db.serialize(() => {
    if (users_in_database.includes(member.user.id) === false && !member.user.bot) {
      console.log('New User ADDED')
      let sql = "INSERT INTO users (id) VALUES (?)";
      let data = [member.user.id];
      db.run(sql, data)
      sql = "INSERT INTO duration (user_id) VALUES (?)";
      db.run(sql, data)
    }
  });
  //member.guild.channels.cache.find(c => c.name === "welcome").send(`"${member.user.username}" has joined this server`);
});



client.on('voiceStateUpdate', (oldstate, newstate) => {
  let newUserChannel = newstate.channelId
  let oldUserChannel = oldstate.channelId


  if(oldUserChannel === null && newUserChannel !== null) {

    // User Joins a voice channel
    console.log(newstate.member.user.username + ' joined');
    // add start time to temp database
    let user_id = newstate.member.user.id;
    let start_time = Date.now();
    let sql = "UPDATE duration SET start_time = (?) WHERE user_id = (?)";
    let data = [start_time, user_id]
    if (!newstate.member.user.bot) {
      db.run(sql, data)
    }


  } else if(newUserChannel === null){

    // User leaves a voice channel
    console.log(newstate.member.user.username + ' left');
    // database
    let user_id = newstate.member.user.id;
    let sql = "SELECT start_time FROM duration WHERE user_id = (?)";
    let data = [user_id]

    db.get(sql, data, (err, row) => {
        let start_time = row.start_time;
        let end_time = Date.now();
        let duration = end_time - start_time;
        // record session
        let date = get_date(start_time);
        let sql = "INSERT INTO sessions (user_id, date, year, month, day, hour_minutes, duration) VALUES (?, ?, ?, ?, ?, ?, ?)";
        let data = [user_id, date.numeric_date, date.year, date.month, date.day, date.hour_minutes, duration / 1000];
        if (!newstate.member.user.bot) {
          db.run(sql, data)
        }
    });
    
    
  }
})


client.on("messageCreate", (message) => {
  if (!message.content.startsWith(config.prefix) || message.author.bot) {return};

  const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
  const command = args.shift().toLowerCase();

  let id = message.author.id;
  let name = message.author.username;

  let sql = '';
  let data = [id];
  let messages = [];
  let feedback_messege = '';

  (async () => {

    if (command === 'time') {
    
      if (args.length === 0) {

        sql = "SELECT duration, hour_minutes FROM sessions WHERE user_id = (?) AND year = (?) AND month = (?) AND day = (?)";
        let date = get_date(Date.now());
        data.push(date.year, date.month, date.day)
        let time = await caculate_time(sql, data);
        messages.push(`${name} has studied for ${time.hours} hours and ${time.minutes} minutes on this day.`);
        time.sessions.forEach((session) => {
          messages.push(`    At ${session.hour_minutes} studied for ${session.duration} minutes.`)
        });
        feedback_messege = messages.join('\n');

      } else if (args.length === 1) {

        if (args[0] === 'all') {

          sql = "SELECT duration FROM sessions WHERE user_id = (?)";
          let time = await caculate_time(sql, data);
          let user_date = get_date(message.member.joinedTimestamp);
          let bot_date = get_date(message.guild.members.cache.get(client.user.id).joinedTimestamp);
          let date;
          if (bot_date.numeric_date > user_date.numeric_date) {
            date = bot_date;
          } else {
            date = user_date;
          }
          feedback_messege = `${name} has studied for ${time.hours_rounded} hours since ${date.joined_date}.`;

        } else if (args[0] === 'week') {

          sql = "SELECT duration FROM sessions WHERE user_id = (?) AND date >= (?)";
          let date = get_date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          data.push(date.numeric_date)
          let time = await caculate_time(sql, data);
          messages.push(`${name} has studied for ${time.hours} hours and ${time.minutes} minutes on the last 7 days.`);
          let avg_time = time.total / 7;
          messages.push(`Averaging ${Math.trunc(avg_time / 3600)} hours and ${Math.round((avg_time % 3600) / 60)} minutes a day.`)
          feedback_messege = messages.join('\n');

        } else if (args[0] === 'month') {

          sql = "SELECT duration FROM sessions WHERE user_id = (?) AND date >= (?)";
          let date = get_date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          data.push(date.numeric_date)
          let time = await caculate_time(sql, data);
          messages.push(`${name} has studied for ${time.hours_rounded} hours on the last 30 days.`);
          let avg_time = time.total / 30;
          messages.push(`Averaging ${Math.trunc(avg_time / 3600)} hours and ${Math.round((avg_time % 3600) / 60)} minutes a day.`)
          feedback_messege = messages.join('\n');

        } else if (args[0] === 'report') {

          //calculate total
          sql = "SELECT duration FROM sessions WHERE user_id = (?)";
          let time = await caculate_time(sql, data);
          let user_date = get_date(message.member.joinedTimestamp);
          let bot_date = get_date(message.guild.members.cache.get(client.user.id).joinedTimestamp);
          let date;
          if (bot_date.numeric_date > user_date.numeric_date) {
            date = bot_date;
          } else {
            date = user_date;
          }
          messages.push(`${name} has studied for ${time.hours_rounded} hours since ${date.joined_date}.`);

          //calculate for every year
          let years = get_date(Date.now()).year - date.year;
          for (let i = years; i >= 0; i--) {
            let year = get_date(Date.now()).year - i;
            sql = "SELECT duration FROM sessions WHERE user_id = (?) AND year = (?)";
            data.push(year)
            let time = await caculate_time(sql, data);
            messages.push(`${year}: ${time.hours_rounded} hours disrubuted as follows:`);

            //calculate for every month of that year
            for (let month = 1; month <13; month++) {
              if ((i === years && month < date.month) || (i === 0 && month > get_date(Date.now()).month)) {
                //messages.push(`    ${months[month - 1]}: N/A.`);
              } else {
                let data_copy = [data[0], data[1]];
                sql = "SELECT duration FROM sessions WHERE user_id = (?) AND year = (?) AND month = (?)";
                data_copy.push(month);
                let time = await caculate_time(sql, data_copy);
                messages.push(`    ${months[month - 1]}: ${time.hours_rounded} hours.`)
              }
            }
          }

          //construct the feedback_messege
          feedback_messege = messages.join('\n');

        } else {
          feedback_messege = 'Command Not Supported. Type !help To See All Commands';
        }
        
      } else {
        feedback_messege = 'Command Not Supported. Type !help To See All Commands';
      }
  
      message.channel.send(feedback_messege)

        
    } else if (command === 'leaderboards') {
      
      if (args.length === 1 && args[0] === 'month') {
        sql = `SELECT duration FROM sessions WHERE user_id = (?) And month = ${get_date(Date.now()).month}`;
      } else{
        sql = `SELECT duration FROM sessions WHERE user_id = (?)`;
      }
      let users = await caculate_members(message.guildId, sql)
      for (let i = 0; i < users.length; i++) {
        if (i === 10) {
          break;
        }
        messages.push(`${i + 1}. ${users[i].username} with ${users[i].time.hours_rounded} hours studied.`)
      }

      message.channel.send(messages.join('\n'))
      
    } else if (command === 'test') {

      let guild = client.guilds.cache.get(message.guildId);
      let channels = guild.channels.cache.filter(channel => channel.isTextBased());
      channels.forEach((channel) => {
        channel.send('test')
      })

    } else if (command === 'help') {

      let commands = ['!time', '    !time all', '    !time week', '    !time month', '    !time report', '!leaderboards', '    !leaderboards month'];
      message.channel.send(commands.join('\n'));

    } else {
      message.channel.send('Command Not Supported. Type !help To See All Commands');
    }
    
  }) ();

});

client.login(config.token);




